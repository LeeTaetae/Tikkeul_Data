"""Account persistence. MongoDB is authoritative whenever its URI is configured.

Integer IDs preserve the existing JWT, favorites and trips contracts.
"""
from contextlib import contextmanager

from pymongo import MongoClient, ReturnDocument
from pymongo.errors import DuplicateKeyError, PyMongoError
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.auth.models import User
from app.errors import api_error


class SqlUsers(Session):
    def by_email(self, email):
        return self.exec(select(User).where(User.email == email)).first()

    def by_social(self, provider, provider_id):
        return self.exec(select(User).where(User.provider == provider, User.provider_id == provider_id)).first()

    def all_users(self):
        return list(self.exec(select(User).order_by(User.id)).all())


class MongoUsers:
    def __init__(self, database):
        self.db = database
        self.pending = {}
        self.original = {}

    def _load(self, document):
        if document is None:
            return None
        user = User.model_validate({key: value for key, value in document.items() if key != "_id"})
        self.original[user.id] = user.model_dump()
        return user

    def by_email(self, email):
        return self._load(self.db.users.find_one({"email": email}))

    def by_social(self, provider, provider_id):
        return self._load(self.db.users.find_one({"provider": provider, "provider_id": provider_id}))

    def all_users(self):
        return [self._load(document) for document in self.db.users.find(sort=[("id", 1)])]

    def get(self, model, user_id):
        return self._load(self.db.users.find_one({"id": user_id}))

    def add(self, user):
        self.pending[id(user)] = user

    def flush(self):
        for user in self.pending.values():
            if user.id is None:
                counter = self.db.counters.find_one_and_update(
                    {"_id": "users"}, {"$inc": {"value": 1}}, upsert=True, return_document=ReturnDocument.AFTER
                )
                user.id = counter["value"]

    def commit(self):
        self.flush()
        for user in self.pending.values():
            document = user.model_dump()
            original = self.original.get(user.id)
            if original is None:
                self.db.users.insert_one(document)
            else:
                changes = {key: value for key, value in document.items() if value != original.get(key)}
                if changes:
                    result = self.db.users.update_one({"id": user.id}, {"$set": changes})
                    if not result.matched_count:
                        raise api_error("UNAUTHORIZED")
            self.original[user.id] = document
        self.pending.clear()

    def refresh(self, user):
        # Mongo writes are acknowledged; there are no server-generated user fields.
        pass

    def rollback(self):
        self.pending.clear()


@contextmanager
def user_session(request):
    database = getattr(request.app.state, "user_database", None)
    try:
        if database is not None:
            yield MongoUsers(database)
        else:
            with SqlUsers(request.app.state.db_engine) as session:
                yield session
    except (DuplicateKeyError, IntegrityError):
        raise api_error("EMAIL_TAKEN") from None
    except PyMongoError:
        # Driver messages may contain hosts and connection details. Do not expose them.
        raise api_error("AUTH_DB_UNAVAILABLE") from None


def open_user_database(settings):
    uri = settings.secret("mongodb_uri")
    if uri is None:
        return None, None
    client = MongoClient(uri, serverSelectionTimeoutMS=10000, connectTimeoutMS=10000, tz_aware=True)
    try:
        database = client[settings.mongodb_database]
        database.command("ping")
        database.users.create_index("id", unique=True)
        database.users.create_index("email", unique=True, partialFilterExpression={"email": {"$type": "string"}})
        database.users.create_index(
            [("provider", 1), ("provider_id", 1)], unique=True,
            partialFilterExpression={"provider_id": {"$type": "string"}},
        )
        highest = database.users.find_one(sort=[("id", -1)])
        database.counters.update_one({"_id": "users"}, {"$max": {"value": highest["id"] if highest else 0}}, upsert=True)
        return client, database
    except PyMongoError:
        client.close()
        raise RuntimeError("MongoDB account storage initialization failed; check connectivity and credentials.") from None

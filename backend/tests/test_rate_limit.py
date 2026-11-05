from app.auth.rate_limit import AttemptLimiter, ResendCooldown


def test_second_attempt_within_cooldown_is_blocked(engine, clock):
    limiter = ResendCooldown(engine, "test", cooldown_s=60.0, clock=clock)
    assert limiter.try_mark(1) is True
    assert limiter.try_mark(1) is False


def test_attempt_after_cooldown_elapses_is_allowed_again(engine, clock):
    limiter = ResendCooldown(engine, "test", cooldown_s=60.0, clock=clock)
    assert limiter.try_mark(1) is True
    clock.advance(60.0)
    assert limiter.try_mark(1) is True


def test_different_users_do_not_share_a_cooldown(engine, clock):
    limiter = ResendCooldown(engine, "test", cooldown_s=60.0, clock=clock)
    assert limiter.try_mark(1) is True
    assert limiter.try_mark(2) is True


def test_different_buckets_do_not_share_state(engine, clock):
    """같은 키라도 bucket 이 다르면(예: login vs signup_code) 서로 영향을 주지 않는다."""
    login = AttemptLimiter(engine, "login", max_attempts=1, window_s=60.0, clock=clock)
    signup = AttemptLimiter(engine, "signup_code", max_attempts=1, window_s=60.0, clock=clock)
    assert login.try_attempt("a@b.com") is True
    assert login.try_attempt("a@b.com") is False
    assert signup.try_attempt("a@b.com") is True


def test_state_survives_a_new_limiter_instance(engine, clock):
    """같은 engine·bucket 으로 새 인스턴스를 만들어도(= 다른 워커 프로세스를 흉내) 카운트가 이어진다."""
    first = AttemptLimiter(engine, "login", max_attempts=2, window_s=60.0, clock=clock)
    assert first.try_attempt("a@b.com") is True
    second = AttemptLimiter(engine, "login", max_attempts=2, window_s=60.0, clock=clock)
    assert second.try_attempt("a@b.com") is True
    assert second.try_attempt("a@b.com") is False

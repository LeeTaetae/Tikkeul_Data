import type { TFunction } from 'i18next';

import { ApiClientError } from '../api/client';

/** 로그인/가입 화면에 보여줄 오류 문구. 서버 오류 코드를 사람이 읽을 i18n 문구로 바꾼다. */
export function authErrorMessage(error: unknown, t: TFunction): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'FORBIDDEN') return t('auth.adminRequired');
    if (error.code === 'ACCOUNT_DISABLED') return t('auth.accountDisabled');
    if (error.code === 'CANNOT_DISABLE_SELF') return t('auth.adminCannotDisableSelf');
    if (error.code === 'USER_NOT_FOUND') return t('auth.adminUserNotFound');
    if (error.code === 'AUTH_DB_UNAVAILABLE') return t('auth.networkError');
    if (error.code === 'EMAIL_TAKEN') return t('auth.emailTaken');
    if (error.code === 'INVALID_CREDENTIALS') return t('auth.loginFailed');
    if (error.code === 'EMAIL_ALREADY_VERIFIED') return t('auth.alreadyVerified');
    if (error.code === 'EMAIL_SEND_FAILED') return t('auth.verificationSendFailed');
    if (error.code === 'TOO_MANY_REQUESTS') return t('auth.verificationTooSoon');
    if (error.code === 'INVALID_CODE') return t('auth.codeInvalid');
    if (error.code === 'EMAIL_NOT_VERIFIED') return t('auth.emailNotVerifiedYet');
    if (error.kind === 'notConfigured') return t('auth.verificationNotConfigured');
    if (error.kind === 'invalid') return t('auth.emailInvalid');
    if (error.kind === 'network' || error.kind === 'timeout') return t('auth.networkError');
  }
  return t('auth.genericError');
}

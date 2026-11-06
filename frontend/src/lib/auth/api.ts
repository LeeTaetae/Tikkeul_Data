import { createApiClient, type RequestOptions } from '../api/client';
import { API_BASE_URL } from '../config';

const client = createApiClient({ baseUrl: API_BASE_URL });

export interface AuthUser {
  id: number;
  provider: string;
  email: string | null;
  nickname: string | null;
  email_verified: boolean;
  role: 'user' | 'admin';
  status: 'active' | 'disabled';
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  user: AuthUser;
}

export const authApi = {
  signup: (email: string, password: string, verifyToken: string, options?: RequestOptions) =>
    client.post<TokenResponse>('/api/auth/signup', { email, password, verify_token: verifyToken }, options),
  login: (email: string, password: string, options?: RequestOptions) =>
    client.post<TokenResponse>('/api/auth/login', { email, password }, options),
  adminMe: (token: string, options?: RequestOptions) =>
    client.get<AuthUser>('/api/auth/admin/me', {}, { ...options, token }),
  adminUsers: (token: string, options?: RequestOptions) =>
    client.get<AuthUser[]>('/api/auth/admin/users', {}, { ...options, token }),
  adminSetUserStatus: (token: string, userId: number, status: AuthUser['status'], options?: RequestOptions) =>
    client.patch<AuthUser>(`/api/auth/admin/users/${userId}/status`, { status }, { ...options, token }),
  loginGoogle: (idToken: string, options?: RequestOptions) =>
    client.post<TokenResponse>('/api/auth/social/google', { id_token: idToken }, options),
  loginKakao: (accessToken: string, options?: RequestOptions) =>
    client.post<TokenResponse>('/api/auth/social/kakao', { access_token: accessToken }, options),
  me: (token: string, options?: RequestOptions) => client.get<AuthUser>('/api/auth/me', {}, { ...options, token }),
  checkEmail: (email: string, options?: RequestOptions) =>
    client.get<{ available: boolean }>('/api/auth/check-email', { email }, options),
  sendVerification: (token: string, options?: RequestOptions) =>
    client.post<{ sent: boolean }>('/api/auth/send-verification', {}, { ...options, token }),
  // 가입 전 이메일 인증번호(6자리): 발송 -> 확인 순으로 쓴다. verifySignupCode 가 돌려주는 token 을 signup() 의 verifyToken 으로 넘긴다.
  sendSignupCode: (email: string, options?: RequestOptions) =>
    client.post<{ sent: boolean; challenge: string }>('/api/auth/signup/send-code', { email }, options),
  verifySignupCode: (email: string, code: string, challenge: string, options?: RequestOptions) =>
    client.post<{ verified: boolean; token: string }>('/api/auth/signup/verify-code', { email, code, challenge }, options),
  // 비밀번호 재설정: 코드 발송(계정 존재 여부는 숨김) -> 코드 확인(token 발급) -> 재설정(token + 새 비밀번호).
  sendPasswordResetCode: (email: string, options?: RequestOptions) =>
    client.post<{ sent: boolean; challenge: string | null; social_only: boolean }>('/api/auth/password-reset/send-code', { email }, options),
  verifyPasswordResetCode: (email: string, code: string, challenge: string, options?: RequestOptions) =>
    client.post<{ verified: boolean; token: string }>('/api/auth/password-reset/verify-code', { email, code, challenge }, options),
  resetPassword: (token: string, newPassword: string, options?: RequestOptions) =>
    client.post<AuthUser>('/api/auth/password-reset', { token, new_password: newPassword }, options),
};

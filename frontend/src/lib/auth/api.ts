import { createApiClient, type RequestOptions } from '../api/client';
import { API_BASE_URL } from '../config';

const client = createApiClient({ baseUrl: API_BASE_URL });

export interface AuthUser {
  id: number;
  email: string;
  email_verified: boolean;
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
};

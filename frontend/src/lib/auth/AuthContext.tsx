import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { GoogleSignin, isCancelledResponse, isSuccessResponse } from '@react-native-google-signin/google-signin';

import { authApi, type AuthUser } from './api';
import { clearToken, getToken, setToken } from './storage';
import { loginWithKakaoNative } from '../../native/kakaoLogin';

interface AuthState {
  // loading: 저장된 토큰 확인 중(앱 시작 직후). guest: 비로그인. authenticated: 로그인됨.
  status: 'loading' | 'guest' | 'authenticated';
  user: AuthUser | null;
  token: string | null;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string, adminOnly?: boolean) => Promise<AuthUser>;
  loginWithGoogle: () => Promise<void>;
  loginWithKakao: () => Promise<void>;
  signup: (email: string, password: string, verifyToken: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null, token: null });

  // 앱 시작 시 저장된 토큰이 있으면 아직 유효한지 /me 로 확인한다. 만료·폐기됐으면 조용히 비로그인으로 돌아간다.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = await getToken();
      if (!token) {
        if (!cancelled) setState({ status: 'guest', user: null, token: null });
        return;
      }
      try {
        const user = await authApi.me(token);
        if (!cancelled) setState({ status: 'authenticated', user, token });
      } catch {
        await clearToken();
        if (!cancelled) setState({ status: 'guest', user: null, token: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (email: string, password: string, adminOnly = false) => {
    const res = await (adminOnly ? authApi.adminLogin(email, password) : authApi.login(email, password));
    await setToken(res.access_token);
    setState({ status: 'authenticated', user: res.user, token: res.access_token });
    return res.user;
  };

  // 구글 네이티브 로그인: 구글 SDK 로 idToken 을 받아 백엔드로 교환한다. 사용자가 취소하면 조용히 돌아간다(오류 아님).
  const loginWithGoogle = async () => {
    GoogleSignin.configure({
      webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    });
    const response = await GoogleSignin.signIn();
    if (isCancelledResponse(response)) {
      throw Object.assign(new Error('Google 로그인을 취소했습니다.'), { code: 'GOOGLE_SIGNIN_CANCELLED' });
    }
    if (!isSuccessResponse(response) || !response.data.idToken) {
      throw new Error('Google 로그인에서 idToken 을 받지 못했습니다.');
    }
    const res = await authApi.loginGoogle(response.data.idToken);
    await setToken(res.access_token);
    setState({ status: 'authenticated', user: res.user, token: res.access_token });
  };

  // 카카오 네이티브 로그인: 카카오 SDK 로 accessToken 을 받아 백엔드로 교환한다. 취소는 KAKAO_LOGIN_CANCELLED 로 구분한다.
  const loginWithKakao = async () => {
    const accessToken = await loginWithKakaoNative();
    const res = await authApi.loginKakao(accessToken);
    await setToken(res.access_token);
    setState({ status: 'authenticated', user: res.user, token: res.access_token });
  };

  const signup = async (email: string, password: string, verifyToken: string) => {
    const res = await authApi.signup(email, password, verifyToken);
    await setToken(res.access_token);
    setState({ status: 'authenticated', user: res.user, token: res.access_token });
  };

  const logout = async () => {
    await clearToken();
    setState({ status: 'guest', user: null, token: null });
  };

  const value = useMemo<AuthContextValue>(() => ({ ...state, login, loginWithGoogle, loginWithKakao, signup, logout }), [state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

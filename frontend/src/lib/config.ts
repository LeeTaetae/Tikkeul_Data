// EXPO_PUBLIC_ 변수는 번들에 포함되어 공개된다. 비밀값을 넣지 않는다.
export const API_BASE_URL: string = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

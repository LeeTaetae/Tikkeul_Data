# LiteRT(TFLite) 는 JNI 에서 클래스·필드를 이름으로 찾는다. R8 이 줄이거나 이름을 바꾸면 모델 로드가 실패한다.
-keep class org.tensorflow.lite.** { *; }
-keep class com.google.ai.edge.litert.** { *; }

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Owned exclusively by the native car controller, never shared with Expo/transit speech.
// Mirrors modules/kakao-navigation/android/.../CarVoiceSpeaker.kt (Android TTS -> AVSpeechSynthesizer here).
@interface CarVoiceSpeaker : NSObject

- (instancetype)initWithFailureHandler:(void (^)(void))onFailure;
- (void)setLanguage:(NSString *)language; // "ko" | "en" | "zh"
- (void)speak:(NSString *)text;
- (void)stop;

@end

NS_ASSUME_NONNULL_END

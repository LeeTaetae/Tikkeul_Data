#import <Foundation/Foundation.h>
#import <KNSDK/KNSDK.h>

NS_ASSUME_NONNULL_BEGIN

// SDK event identifiers only: never translate or speak Korean node/road names as foreign speech.
// Mirrors modules/kakao-navigation/android/.../CarVoiceText.kt so EN/ZH car guidance matches on both platforms.
NSString *_Nullable KNCarVoiceText(NSString *language, KNGuide_Voice *voice);

NS_ASSUME_NONNULL_END

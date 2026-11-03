#import "CarVoiceSpeaker.h"
#import <AVFoundation/AVFoundation.h>

@interface CarVoiceSpeaker ()
@property(nonatomic, copy) void (^onFailure)(void);
@property(nonatomic, strong) AVSpeechSynthesizer *synthesizer;
@property(nonatomic, copy) NSString *language;
@end

@implementation CarVoiceSpeaker

- (instancetype)initWithFailureHandler:(void (^)(void))onFailure {
  self = [super init];
  if (self) {
    _onFailure = [onFailure copy];
    _synthesizer = [[AVSpeechSynthesizer alloc] init];
    _language = @"ko";
  }
  return self;
}

- (void)setLanguage:(NSString *)language {
  [self.synthesizer stopSpeakingAtBoundary:AVSpeechBoundaryImmediate];
  _language = [language copy]; // direct ivar: self.language = ... would re-enter this same setter
}

- (nullable NSString *)bcp47ForCurrentLanguage {
  if ([self.language isEqualToString:@"zh"]) return @"zh-CN";
  if ([self.language isEqualToString:@"en"]) return @"en-US";
  return nil; // Korean guidance stays on the SDK's own recorded voice.
}

- (void)speak:(NSString *)text {
  if ([self.language isEqualToString:@"ko"]) return;
  NSString *bcp47 = [self bcp47ForCurrentLanguage];
  AVSpeechSynthesisVoice *voice = bcp47 ? [AVSpeechSynthesisVoice voiceWithLanguage:bcp47] : nil;
  if (!voice) {
    if (self.onFailure) self.onFailure();
    return;
  }
  [self.synthesizer stopSpeakingAtBoundary:AVSpeechBoundaryImmediate];
  AVSpeechUtterance *utterance = [AVSpeechUtterance speechUtteranceWithString:text];
  utterance.voice = voice;
  utterance.rate = AVSpeechUtteranceDefaultSpeechRate;
  [self.synthesizer speakUtterance:utterance];
}

- (void)stop {
  [self.synthesizer stopSpeakingAtBoundary:AVSpeechBoundaryImmediate];
}

@end

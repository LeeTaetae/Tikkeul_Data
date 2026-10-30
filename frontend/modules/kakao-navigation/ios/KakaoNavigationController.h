#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface KakaoNavigationController : UIViewController
+ (NSDictionary *)configuration;
- (instancetype)initWithOptions:(NSDictionary *)options
                     completion:(void (^)(NSString * _Nullable code, NSString * _Nullable message))completion;
- (void)cancelNavigation;
@end

NS_ASSUME_NONNULL_END

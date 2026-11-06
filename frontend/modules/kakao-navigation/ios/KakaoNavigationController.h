#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface KakaoNavigationController : UIViewController
+ (NSDictionary *)configuration;
- (instancetype)initWithOptions:(NSDictionary *)options
                     completion:(void (^)(NSString * _Nullable code, NSString * _Nullable message))completion;
- (void)cancelNavigation;

/** SDK location/route input for the product "onGuidance" channel, at most one location per second. */
@property(nonatomic, copy, nullable) void (^eventHandler)(NSDictionary *event);

/** 위험 레일 스냅샷(JSON)을 주행 화면 오버레이로 보낸다. 판단은 JS 가 하고 네이티브는 그리기만 한다. 어느 스레드에서 불러도 된다 */
+ (void)setHazardRailJSON:(NSString *)json;
+ (void)clearHazardRail;
+ (void)setWeatherSafetyBanner:(NSString *)text;
@end

NS_ASSUME_NONNULL_END

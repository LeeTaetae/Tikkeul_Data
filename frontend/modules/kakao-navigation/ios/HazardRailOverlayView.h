#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/**
 카카오 SDK 주행 화면 왼쪽 위험 레일(iOS). JS(useNativeHazardRail)가 판단해서 만든 스냅샷(JSON)을 그리기만 한다.
 위험 판정·우선순위·단계는 JS 로직이고 여기에는 없다. 스냅샷은 매번 전체 상태를 교체한다(통과한 위험은 목록에서 빠지면 사라진다).
 SDK 뷰는 읽기만 하고 수정·제거하지 않는다. 터치는 아래 SDK 화면으로 그대로 전달된다(userInteractionEnabled = NO).
 Android(HazardRailOverlay.kt)와 같은 배치 규칙을 따른다.
 */
@interface HazardRailOverlayView : UIView

/** language: ko | en | zh (카드의 위험 유형 이름 언어) */
- (instancetype)initWithLanguage:(NSString *)language;

/** host 위에 전체 크기로 얹고, navi(KNNaviView) 안의 SDK 요소 위치를 읽어 배치한다 */
- (void)attachToHost:(UIView *)host naviView:(UIView *)navi;

/** nil 이면 비운다. 어느 스레드에서 불러도 된다 */
- (void)applySnapshotJSON:(nullable NSString *)json;

- (void)detach;

@end

NS_ASSUME_NONNULL_END

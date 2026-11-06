// 위험 레일 아이콘(Lucide, ISC). tools 로 생성한 코드이며 24x24 좌표의 벡터 경로다. 색·선 굵기는 호출하는 쪽에서 정한다.
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/** type: accident | accident_prone | construction | congestion | school_zone. 24x24 기준 경로(모르는 type 은 accident 모양) */
UIBezierPath *TKHazardIconPath(NSString *type);

NS_ASSUME_NONNULL_END

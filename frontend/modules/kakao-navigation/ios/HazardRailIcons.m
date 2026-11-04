// 위험 레일 아이콘(Lucide, ISC). 24x24 좌표. 생성된 코드: 호(arc)는 3차 베지어로 바꿔 두었다.
#import "HazardRailIcons.h"

// Lucide "triangle-alert"
static UIBezierPath *TKPath_accident(void) {
  UIBezierPath *p = [UIBezierPath bezierPath];
  [p moveToPoint:CGPointMake(21.73, 18)];
  [p addLineToPoint:CGPointMake(13.73, 4)];
  [p addCurveToPoint:CGPointMake(11.99, 2.9861) controlPoint1:CGPointMake(13.3749, 3.3734) controlPoint2:CGPointMake(12.7103, 2.9861)];
  [p addCurveToPoint:CGPointMake(10.25, 4) controlPoint1:CGPointMake(11.2697, 2.9861) controlPoint2:CGPointMake(10.6051, 3.3734)];
  [p addLineToPoint:CGPointMake(2.25, 18)];
  [p addCurveToPoint:CGPointMake(2.2544, 20.0078) controlPoint1:CGPointMake(1.8911, 18.6216) controlPoint2:CGPointMake(1.8928, 19.3878)];
  [p addCurveToPoint:CGPointMake(4, 21) controlPoint1:CGPointMake(2.6161, 20.6278) controlPoint2:CGPointMake(3.2823, 21.0065)];
  [p addLineToPoint:CGPointMake(20, 21)];
  [p addCurveToPoint:CGPointMake(21.7305, 19.9991) controlPoint1:CGPointMake(20.7142, 20.9993) controlPoint2:CGPointMake(21.3737, 20.6178)];
  [p addCurveToPoint:CGPointMake(21.73, 18) controlPoint1:CGPointMake(22.0873, 19.3804) controlPoint2:CGPointMake(22.0871, 18.6185)];
  [p moveToPoint:CGPointMake(12, 9)];
  [p addLineToPoint:CGPointMake(12, 13)];
  [p moveToPoint:CGPointMake(12, 17)];
  [p addLineToPoint:CGPointMake(12.01, 17)];
  return p;
}

// Lucide "construction"
static UIBezierPath *TKPath_construction(void) {
  UIBezierPath *p = [UIBezierPath bezierPath];
  [p moveToPoint:CGPointMake(3, 6)];
  [p addLineToPoint:CGPointMake(21, 6)];
  [p addCurveToPoint:CGPointMake(22, 7) controlPoint1:CGPointMake(21.5523, 6) controlPoint2:CGPointMake(22, 6.4477)];
  [p addLineToPoint:CGPointMake(22, 13)];
  [p addCurveToPoint:CGPointMake(21, 14) controlPoint1:CGPointMake(22, 13.5523) controlPoint2:CGPointMake(21.5523, 14)];
  [p addLineToPoint:CGPointMake(3, 14)];
  [p addCurveToPoint:CGPointMake(2, 13) controlPoint1:CGPointMake(2.4477, 14) controlPoint2:CGPointMake(2, 13.5523)];
  [p addLineToPoint:CGPointMake(2, 7)];
  [p addCurveToPoint:CGPointMake(3, 6) controlPoint1:CGPointMake(2, 6.4477) controlPoint2:CGPointMake(2.4477, 6)];
  [p closePath];
  [p moveToPoint:CGPointMake(17, 14)];
  [p addLineToPoint:CGPointMake(17, 21)];
  [p moveToPoint:CGPointMake(7, 14)];
  [p addLineToPoint:CGPointMake(7, 21)];
  [p moveToPoint:CGPointMake(17, 3)];
  [p addLineToPoint:CGPointMake(17, 6)];
  [p moveToPoint:CGPointMake(7, 3)];
  [p addLineToPoint:CGPointMake(7, 6)];
  [p moveToPoint:CGPointMake(10, 14)];
  [p addLineToPoint:CGPointMake(2.3, 6.3)];
  [p moveToPoint:CGPointMake(14, 6)];
  [p addLineToPoint:CGPointMake(21.7, 13.7)];
  [p moveToPoint:CGPointMake(8, 6)];
  [p addLineToPoint:CGPointMake(16, 14)];
  return p;
}

// Lucide "car"
static UIBezierPath *TKPath_congestion(void) {
  UIBezierPath *p = [UIBezierPath bezierPath];
  [p moveToPoint:CGPointMake(19, 17)];
  [p addLineToPoint:CGPointMake(21, 17)];
  [p addCurveToPoint:CGPointMake(22, 16) controlPoint1:CGPointMake(21.6, 17) controlPoint2:CGPointMake(22, 16.6)];
  [p addLineToPoint:CGPointMake(22, 13)];
  [p addCurveToPoint:CGPointMake(20.5, 11.1) controlPoint1:CGPointMake(22, 12.1) controlPoint2:CGPointMake(21.3, 11.3)];
  [p addCurveToPoint:CGPointMake(16, 10) controlPoint1:CGPointMake(18.7, 10.6) controlPoint2:CGPointMake(16, 10)];
  [p addCurveToPoint:CGPointMake(13.8, 7.7) controlPoint1:CGPointMake(16, 10) controlPoint2:CGPointMake(14.7, 8.6)];
  [p addCurveToPoint:CGPointMake(12, 7) controlPoint1:CGPointMake(13.3, 7.3) controlPoint2:CGPointMake(12.7, 7)];
  [p addLineToPoint:CGPointMake(5, 7)];
  [p addCurveToPoint:CGPointMake(3.6, 7.9) controlPoint1:CGPointMake(4.4, 7) controlPoint2:CGPointMake(3.9, 7.4)];
  [p addLineToPoint:CGPointMake(2.2, 10.8)];
  [p addCurveToPoint:CGPointMake(2, 12) controlPoint1:CGPointMake(2.0676, 11.1862) controlPoint2:CGPointMake(2, 11.5917)];
  [p addLineToPoint:CGPointMake(2, 16)];
  [p addCurveToPoint:CGPointMake(3, 17) controlPoint1:CGPointMake(2, 16.6) controlPoint2:CGPointMake(2.4, 17)];
  [p addLineToPoint:CGPointMake(5, 17)];
  [p moveToPoint:CGPointMake(5, 17)];
  [p addCurveToPoint:CGPointMake(7, 19) controlPoint1:CGPointMake(5, 18.1046) controlPoint2:CGPointMake(5.8954, 19)];
  [p addCurveToPoint:CGPointMake(9, 17) controlPoint1:CGPointMake(8.1046, 19) controlPoint2:CGPointMake(9, 18.1046)];
  [p addCurveToPoint:CGPointMake(7, 15) controlPoint1:CGPointMake(9, 15.8954) controlPoint2:CGPointMake(8.1046, 15)];
  [p addCurveToPoint:CGPointMake(5, 17) controlPoint1:CGPointMake(5.8954, 15) controlPoint2:CGPointMake(5, 15.8954)];
  [p closePath];
  [p moveToPoint:CGPointMake(9, 17)];
  [p addLineToPoint:CGPointMake(15, 17)];
  [p moveToPoint:CGPointMake(15, 17)];
  [p addCurveToPoint:CGPointMake(17, 19) controlPoint1:CGPointMake(15, 18.1046) controlPoint2:CGPointMake(15.8954, 19)];
  [p addCurveToPoint:CGPointMake(19, 17) controlPoint1:CGPointMake(18.1046, 19) controlPoint2:CGPointMake(19, 18.1046)];
  [p addCurveToPoint:CGPointMake(17, 15) controlPoint1:CGPointMake(19, 15.8954) controlPoint2:CGPointMake(18.1046, 15)];
  [p addCurveToPoint:CGPointMake(15, 17) controlPoint1:CGPointMake(15.8954, 15) controlPoint2:CGPointMake(15, 15.8954)];
  [p closePath];
  return p;
}

// Lucide "shield-check"
static UIBezierPath *TKPath_school_zone(void) {
  UIBezierPath *p = [UIBezierPath bezierPath];
  [p moveToPoint:CGPointMake(20, 13)];
  [p addCurveToPoint:CGPointMake(12.34, 21.95) controlPoint1:CGPointMake(20, 18) controlPoint2:CGPointMake(16.5, 20.5)];
  [p addCurveToPoint:CGPointMake(11.67, 21.94) controlPoint1:CGPointMake(12.1222, 22.0238) controlPoint2:CGPointMake(11.8855, 22.0203)];
  [p addCurveToPoint:CGPointMake(4, 13) controlPoint1:CGPointMake(7.5, 20.5) controlPoint2:CGPointMake(4, 18)];
  [p addLineToPoint:CGPointMake(4, 6)];
  [p addCurveToPoint:CGPointMake(5, 5) controlPoint1:CGPointMake(4, 5.4477) controlPoint2:CGPointMake(4.4477, 5)];
  [p addCurveToPoint:CGPointMake(11.24, 2.28) controlPoint1:CGPointMake(7, 5) controlPoint2:CGPointMake(9.5, 3.8)];
  [p addCurveToPoint:CGPointMake(12.76, 2.28) controlPoint1:CGPointMake(11.6777, 1.9061) controlPoint2:CGPointMake(12.3223, 1.9061)];
  [p addCurveToPoint:CGPointMake(19, 5) controlPoint1:CGPointMake(14.51, 3.81) controlPoint2:CGPointMake(17, 5)];
  [p addCurveToPoint:CGPointMake(20, 6) controlPoint1:CGPointMake(19.5523, 5) controlPoint2:CGPointMake(20, 5.4477)];
  [p closePath];
  [p moveToPoint:CGPointMake(9, 12)];
  [p addLineToPoint:CGPointMake(11, 14)];
  [p addLineToPoint:CGPointMake(15, 10)];
  return p;
}

UIBezierPath *TKHazardIconPath(NSString *type) {
  if ([type isEqualToString:@"construction"]) return TKPath_construction();
  if ([type isEqualToString:@"congestion"]) return TKPath_congestion();
  if ([type isEqualToString:@"school_zone"]) return TKPath_school_zone();
  return TKPath_accident(); // accident, accident_prone: 프로젝트 JS 아이콘처럼 같은 모양, 색으로 구분한다
}

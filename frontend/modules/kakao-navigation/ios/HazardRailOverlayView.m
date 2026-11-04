#import "HazardRailOverlayView.h"
#import "HazardRailIcons.h"
#import <QuartzCore/QuartzCore.h>

// 배치: SDK 가 왼쪽 열에 속도 → 단속 표지 등을 위에서 아래로 쌓는다. 레일은 그 열의 다음 칸이다.
//   레일 시작 = 보이는 왼쪽 열 SDK 요소의 실제 하단 + 16pt (표지가 사라지면 위로 올라온다).
//   아래쪽은 차선 안내·하단 바 등 보이는 SDK 요소의 상단이 한계이고, 모자라면 카드를 먼저 압축한 뒤 칸 수를 줄인다(최대 3개 + N).
//   SDK 요소를 클래스 이름으로 못 찾으면 화면 높이 비율의 고정 위치로 대체한다(하단 고정은 쓰지 않는다).
// ※ SDK 뷰 클래스 이름(KNCurSpeedView 등)은 KNSDK 바이너리에서 확인한 값이고, 실제 화면 배치는 iOS 실기기에서 확인해야 한다.

typedef struct {
  CGFloat icon, nameFont, distFont, padTop, padBottom, nameH, distH, gap, moreH, tileH;
  NSInteger lines;
} TKSize;

typedef struct {
  NSInteger tiles;   // 0 이면 숨김
  BOOL pill;         // +N 알약
  BOOL badge;        // 마지막 칸 위의 +N 배지(알약이 안 들어갈 때)
  CGFloat top;
  NSInteger level;   // 0=보통, 1=압축
} TKPlan;

static const CGFloat kTileW = 76;       // 이름(어린이보호구역 등)이 들어가도록 SDK 표지 폭에 가깝게
static const CGFloat kLeftInset = 12;
static const CGFloat kStackGap = 16;    // SDK 가 왼쪽 열 요소 사이에 두는 간격
static const CGFloat kGrowMargin = 8;   // 칸·카드가 다시 커질 때 두는 여유(깜빡임 방지)
static const CGFloat kBadgePad = 8;     // 배지가 칸 밖으로 걸치는 폭
static const NSInteger kMaxTiles = 3;

static TKSize TKSizeFor(NSInteger level, NSInteger lines) {
  TKSize s;
  if (level == 0) {
    s.icon = 22; s.nameFont = 10; s.distFont = 10; s.padTop = 6; s.padBottom = 5; s.nameH = 13.0 * lines; s.distH = 13; s.gap = 8; s.moreH = 28;
  } else {
    s.icon = 18; s.nameFont = 9; s.distFont = 9; s.padTop = 4; s.padBottom = 4; s.nameH = 12.0 * lines; s.distH = 12; s.gap = 6; s.moreH = 24;
  }
  s.lines = lines;
  s.tileH = s.padTop + s.icon + 2 + s.nameH + 1 + s.distH + s.padBottom;
  return s;
}

static BOOL TKPlanEqual(TKPlan a, TKPlan b) {
  return a.tiles == b.tiles && a.pill == b.pill && a.badge == b.badge && a.level == b.level && fabs(a.top - b.top) < 2.0;
}

static UIColor *TKHex(uint32_t rgb) {
  return [UIColor colorWithRed:((rgb >> 16) & 0xFF) / 255.0 green:((rgb >> 8) & 0xFF) / 255.0 blue:(rgb & 0xFF) / 255.0 alpha:1.0];
}

@interface HazardRailOverlayView ()
@property(nonatomic, copy) NSString *language;
@property(nonatomic, weak, nullable) UIView *host;
@property(nonatomic, weak, nullable) UIView *navi;
@property(nonatomic, strong, nullable) NSTimer *timer;
@property(nonatomic, strong) UIView *column;
@property(nonatomic, copy, nullable) NSArray<NSDictionary *> *items;
@property(nonatomic) NSInteger overflow;
@property(nonatomic) TKPlan applied;
@property(nonatomic) BOOL hasApplied;
@property(nonatomic, copy, nullable) NSString *appliedKey;
@property(nonatomic) CGFloat columnHeight;
@end

@implementation HazardRailOverlayView

- (instancetype)initWithLanguage:(NSString *)language {
  self = [super initWithFrame:CGRectZero];
  if (self) {
    _language = [@[@"ko", @"en", @"zh"] containsObject:language] ? [language copy] : @"ko";
    self.userInteractionEnabled = NO;
    self.backgroundColor = UIColor.clearColor;
    self.clipsToBounds = NO;
    _column = [[UIView alloc] initWithFrame:CGRectZero];
    _column.clipsToBounds = NO;
    _column.hidden = YES;
    [self addSubview:_column];
  }
  return self;
}

- (void)attachToHost:(UIView *)host naviView:(UIView *)navi {
  self.host = host;
  self.navi = navi;
  self.frame = host.bounds;
  self.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  [host addSubview:self];
  __weak typeof(self) weakSelf = self;
  // SDK 표시 상태(표지·차선 안내)가 바뀌는 것을 따라가기 위해 주기적으로 다시 계산한다. 계획이 같으면 아무것도 하지 않는다.
  self.timer = [NSTimer scheduledTimerWithTimeInterval:0.5 repeats:YES block:^(NSTimer *timer) {
    [weakSelf relayoutForce:NO];
  }];
}

- (void)detach {
  [self.timer invalidate];
  self.timer = nil;
  [self removeFromSuperview];
  self.host = nil;
  self.navi = nil;
}

- (void)dealloc { [self.timer invalidate]; }

- (void)applySnapshotJSON:(NSString *)json {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self setDataFromJSON:json];
    [self relayoutForce:YES];
  });
}

// ── 데이터 ───────────────────────────────────────────────────────────────────────────
- (void)setDataFromJSON:(NSString *)json {
  self.items = nil;
  self.overflow = 0;
  if (![json isKindOfClass:NSString.class]) return;
  NSData *data = [json dataUsingEncoding:NSUTF8StringEncoding];
  if (!data) return;
  id root = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
  if (![root isKindOfClass:NSDictionary.class] || [root[@"v"] integerValue] != 1) return;
  NSArray *array = root[@"items"];
  if (![array isKindOfClass:NSArray.class]) return;
  NSMutableArray<NSDictionary *> *out = [NSMutableArray array];
  for (id raw in array) {
    if (![raw isKindOfClass:NSDictionary.class]) continue;
    NSString *type = [raw[@"type"] isKindOfClass:NSString.class] ? raw[@"type"] : @"accident";
    NSString *zone = [raw[@"zoneType"] isKindOfClass:NSString.class] ? raw[@"zoneType"] : @"";
    NSString *emphasis = [raw[@"emphasis"] isKindOfClass:NSString.class] ? raw[@"emphasis"] : @"normal";
    NSInteger distance = [raw[@"distanceM"] isKindOfClass:NSNumber.class] ? [raw[@"distanceM"] integerValue] : 0;
    [out addObject:@{ @"type": type, @"zoneType": zone, @"emphasis": emphasis, @"distanceM": @(distance) }];
  }
  self.items = out;
  self.overflow = MAX(0, [root[@"overflow"] integerValue]);
}

// ── 배치 ─────────────────────────────────────────────────────────────────────────────
- (NSInteger)lines { return [self.language isEqualToString:@"en"] ? 2 : 1; }

- (void)relayoutForce:(BOOL)force {
  UIView *host = self.host;
  if (!host || host.bounds.size.width <= 0 || host.bounds.size.height <= 0) return;
  self.frame = host.bounds;
  TKPlan plan = [self planFor];
  if (!force && self.hasApplied && TKPlanEqual(plan, self.applied)) return;
  [self commit:plan];
}

- (TKPlan)planFor {
  TKPlan hidden = { 0, NO, NO, 0, 0 };
  if (self.items.count == 0) return hidden;
  UIView *host = self.host;
  CGSize size = host.bounds.size;
  UIEdgeInsets inset = host.safeAreaInsets;
  CGFloat stripL = inset.left + kLeftInset, stripR = stripL + kTileW;
  BOOL found = NO;
  CGFloat stackBottom = [self stackBottomLeft:stripL right:stripR found:&found];
  CGFloat top = found ? stackBottom + kStackGap : MAX(inset.top + 200, size.height * 0.30);
  CGFloat limit = [self bottomLimitAbove:(found ? stackBottom : 0) left:stripL right:stripR];
  TKPlan candidate = [self placeTop:top limit:limit margin:0 maxTiles:kMaxTiles minLevel:0];
  if (!self.hasApplied || self.applied.tiles == 0) return candidate;
  TKPlan prev = self.applied;
  BOOL growing = candidate.tiles > prev.tiles || (candidate.tiles == prev.tiles && candidate.level < prev.level);
  if (!growing) return candidate;
  // 칸 수가 늘거나 카드가 다시 커질 때는 여유를 두고 판단한다
  TKPlan safe = [self placeTop:top limit:limit margin:kGrowMargin maxTiles:kMaxTiles minLevel:0];
  BOOL safeGrows = safe.tiles > prev.tiles || (safe.tiles == prev.tiles && safe.level < prev.level);
  return safeGrows ? safe : [self placeTop:top limit:limit margin:0 maxTiles:prev.tiles minLevel:prev.level];
}

/** 가장 많이 들어가는 칸 수를 고른다. 위에서부터(우선순위 순) 자르므로 우선순위 높은 위험이 남는다. 칸 수를 줄이기 전에 카드를 먼저 압축한다. */
- (TKPlan)placeTop:(CGFloat)top limit:(CGFloat)limit margin:(CGFloat)margin maxTiles:(NSInteger)maxTiles minLevel:(NSInteger)minLevel {
  NSInteger count = (NSInteger)self.items.count;
  NSInteger k = MIN(count, maxTiles);
  for (NSInteger n = k; n >= 1; n--) {
    for (NSInteger level = minLevel; level <= 1; level++) {
      TKSize s = TKSizeFor(level, [self lines]);
      BOOL needMore = self.overflow > 0 || count > n;
      NSInteger variants = needMore ? 2 : 1;
      for (NSInteger v = 0; v < variants; v++) {
        BOOL pill = needMore && v == 0;
        BOOL badge = needMore && v == 1;
        CGFloat height = n * (s.tileH + s.gap) - s.gap + (pill ? s.gap + s.moreH : 0);
        if (top + height <= limit - margin) {
          TKPlan plan = { n, pill, badge, top, level };
          return plan;
        }
      }
    }
  }
  TKPlan none = { 0, NO, NO, top, minLevel };
  return none;
}

- (void)commit:(TKPlan)plan {
  TKPlan previous = self.applied;
  BOOL hadApplied = self.hasApplied;
  self.applied = plan;
  self.hasApplied = YES;
  NSMutableString *key = [NSMutableString stringWithFormat:@"%ld|%d|%d|%ld|", (long)plan.tiles, plan.pill, plan.badge, (long)plan.level];
  if (plan.tiles > 0) {
    for (NSInteger i = 0; i < plan.tiles && i < (NSInteger)self.items.count; i++) {
      NSDictionary *it = self.items[i];
      [key appendFormat:@"%@/%@/%@/%@;", it[@"type"], it[@"zoneType"], it[@"emphasis"], it[@"distanceM"]];
    }
    [key appendFormat:@"%ld", (long)(self.overflow + (NSInteger)self.items.count - plan.tiles)];
  }
  if (![key isEqualToString:self.appliedKey]) {
    self.appliedKey = key;
    [self rebuildWithPlan:plan];
  }
  self.column.hidden = plan.tiles == 0;
  BOOL firstShow = !hadApplied || previous.tiles == 0;
  UIEdgeInsets inset = self.host.safeAreaInsets;
  CGRect target = CGRectMake(inset.left + kLeftInset, plan.top - kBadgePad, kTileW + kBadgePad, self.columnHeight + kBadgePad);
  if (firstShow) {
    self.column.frame = target;
  } else if (!CGRectEqualToRect(self.column.frame, target)) {
    [UIView animateWithDuration:0.15 animations:^{ self.column.frame = target; }];
  }
}

// ── SDK 뷰 읽기 ──────────────────────────────────────────────────────────────────────
- (BOOL)isVisible:(UIView *)v {
  if (!v.window || v.bounds.size.width <= 0 || v.bounds.size.height <= 0) return NO;
  for (UIView *cursor = v; cursor && cursor != self.host; cursor = cursor.superview) {
    if (cursor.hidden || cursor.alpha <= 0.05) return NO;
  }
  return YES;
}

- (void)collectViewsIn:(UIView *)root names:(NSArray<NSString *> *)names depth:(NSInteger)depth into:(NSMutableArray<UIView *> *)out {
  if (depth > 8) return;
  for (UIView *child in root.subviews) {
    NSString *cls = NSStringFromClass(child.class);
    for (NSString *name in names) {
      if ([cls isEqualToString:name] || [cls hasSuffix:[@"." stringByAppendingString:name]]) { [out addObject:child]; break; }
    }
    [self collectViewsIn:child names:names depth:depth + 1 into:out];
  }
}

/** 보이는 자손까지 포함한 실제 하단(표지 안의 부속 요소가 영역 밖으로 나올 수 있다) */
- (CGFloat)deepBottomOf:(UIView *)v depth:(NSInteger)depth {
  CGFloat bottom = CGRectGetMaxY([self.host convertRect:v.bounds fromView:v]);
  if (depth < 3) {
    for (UIView *child in v.subviews) {
      if ([self isVisible:child]) bottom = MAX(bottom, [self deepBottomOf:child depth:depth + 1]);
    }
  }
  return bottom;
}

/** SDK 왼쪽 열(안내·속도·단속 표지 등) 중 보이는 요소의 가장 큰 하단. SDK 뷰를 하나도 못 찾으면 found=NO(대체 배치) */
- (CGFloat)stackBottomLeft:(CGFloat)left right:(CGFloat)right found:(BOOL *)found {
  *found = NO;
  UIView *navi = self.navi;
  if (!navi) return 0;
  NSMutableArray<UIView *> *views = [NSMutableArray array];
  [self collectViewsIn:navi names:@[@"KNCurDirectionView", @"KNNextDirectionView", @"KNCompassView", @"KNCurSpeedView", @"KNSafetyView"] depth:0 into:views];
  CGFloat bottom = -CGFLOAT_MAX;
  CGFloat upperLimit = self.host.bounds.size.height * 0.6; // 화면 아래쪽에 있는 요소는 왼쪽 열 쌓임으로 보지 않는다
  for (UIView *v in views) {
    if (![self isVisible:v]) continue;
    CGRect rect = [self.host convertRect:v.bounds fromView:v];
    if (CGRectGetMinY(rect) > upperLimit) continue;
    if (CGRectGetMaxX(rect) <= left || CGRectGetMinX(rect) >= right) continue;
    bottom = MAX(bottom, [self deepBottomOf:v depth:0]);
  }
  if (bottom > -CGFLOAT_MAX / 2) { *found = YES; return bottom; }
  return 0;
}

/** 아래쪽 한계: 레일 아래로 보이는 요소(차선 안내·정보 배너·하단 바)의 가장 높은 상단 − 8pt */
- (CGFloat)bottomLimitAbove:(CGFloat)above left:(CGFloat)left right:(CGFloat)right {
  UIView *host = self.host;
  CGFloat fallback = host.bounds.size.height - host.safeAreaInsets.bottom - 96;
  UIView *navi = self.navi;
  if (!navi) return fallback;
  NSMutableArray<UIView *> *views = [NSMutableArray array];
  [self collectViewsIn:navi names:@[@"KNLaneView", @"KNInfoView", @"KNBottomView", @"KNSectionInfoView"] depth:0 into:views];
  CGFloat limit = CGFLOAT_MAX;
  for (UIView *v in views) {
    if (![self isVisible:v]) continue;
    CGRect rect = [host convertRect:v.bounds fromView:v];
    if (CGRectGetMaxX(rect) <= left || CGRectGetMinX(rect) >= right || CGRectGetMinY(rect) < above) continue;
    limit = MIN(limit, CGRectGetMinY(rect));
  }
  return limit == CGFLOAT_MAX ? fallback : limit - 8;
}

// ── 그리기 ───────────────────────────────────────────────────────────────────────────
+ (NSDictionary<NSString *, NSArray<NSNumber *> *> *)tones {
  // src/theme.ts 의 hazardTone 과 같은 값(tint, accent, strong). 한쪽을 바꾸면 다른 쪽도 맞춘다.
  static NSDictionary *tones;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    tones = @{
      @"accident": @[@0xFEF2F2, @0xDC2626, @0xDC2626],
      @"construction": @[@0xFFFBEB, @0xD97706, @0xB45309],
      @"congestion": @[@0xFEFCE8, @0xA16207, @0x854D0E],
      @"school_zone": @[@0xECFDF5, @0x059669, @0x047857],
      @"accident_prone": @[@0xFDF2F8, @0xBE185D, @0x9D174D],
    };
  });
  return tones;
}

- (NSString *)nameForItem:(NSDictionary *)item {
  static NSDictionary *labels, *zones;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    labels = @{
      @"ko": @{ @"accident": @"사고", @"construction": @"공사", @"congestion": @"정체", @"school_zone": @"보호구역", @"accident_prone": @"사고다발구역" },
      @"en": @{ @"accident": @"Accident", @"construction": @"Roadwork", @"congestion": @"Congestion", @"school_zone": @"Protection zone", @"accident_prone": @"Accident-prone area" },
      @"zh": @{ @"accident": @"事故", @"construction": @"施工", @"congestion": @"拥堵", @"school_zone": @"保护区", @"accident_prone": @"事故多发区" },
    };
    // 보호구역 subtype 이름. 프로젝트 i18n(zoneType)과 같은 뜻이며 카드 폭에 맞게 영어만 짧게 줄였다.
    zones = @{
      @"ko": @{ @"child": @"어린이보호구역", @"senior": @"노인보호구역", @"disabled": @"장애인보호구역", @"unknown": @"보호구역" },
      @"en": @{ @"child": @"School zone", @"senior": @"Senior zone", @"disabled": @"Disabled zone", @"unknown": @"Protection zone" },
      @"zh": @{ @"child": @"儿童保护区", @"senior": @"老年人保护区", @"disabled": @"残疾人保护区", @"unknown": @"保护区" },
    };
  });
  NSString *type = item[@"type"];
  if ([type isEqualToString:@"school_zone"]) {
    NSDictionary *names = zones[self.language] ?: zones[@"ko"];
    NSString *zone = item[@"zoneType"];
    return names[zone.length ? zone : @"unknown"] ?: names[@"unknown"];
  }
  return (labels[self.language] ?: labels[@"ko"])[type] ?: type;
}

- (NSString *)distanceText:(NSInteger)meters {
  if (meters >= 1000) return [NSString stringWithFormat:@"%.1fkm", meters / 1000.0];
  return [NSString stringWithFormat:@"%ldm", (long)meters];
}

- (UILabel *)labelWithText:(NSString *)text font:(CGFloat)font color:(UIColor *)color frame:(CGRect)frame lines:(NSInteger)lines {
  UILabel *label = [[UILabel alloc] initWithFrame:frame];
  label.text = text;
  label.textColor = color;
  label.font = [UIFont systemFontOfSize:font weight:UIFontWeightBold]; // 고정 크기: 사용자 글꼴 배율에 카드가 커지지 않게 한다
  label.textAlignment = NSTextAlignmentCenter;
  label.numberOfLines = lines;
  label.adjustsFontSizeToFitWidth = YES;        // 긴 이름(어린이보호구역, Accident-prone area 등)을 카드 폭에 맞춘다
  label.minimumScaleFactor = 7.0 / font;
  label.baselineAdjustment = UIBaselineAdjustmentAlignCenters;
  label.lineBreakMode = NSLineBreakByClipping;
  return label;
}

- (void)rebuildWithPlan:(TKPlan)plan {
  for (UIView *sub in [self.column.subviews copy]) [sub removeFromSuperview];
  self.columnHeight = 0;
  if (plan.tiles == 0) return;
  TKSize s = TKSizeFor(plan.level, [self lines]);
  NSInteger more = self.overflow + (NSInteger)self.items.count - plan.tiles;
  CGFloat y = kBadgePad; // 위쪽 여유(배지가 걸치는 폭). 배치 때 같은 만큼 위로 보정한다
  for (NSInteger i = 0; i < plan.tiles; i++) {
    UIView *tile = [self tileForItem:self.items[i] size:s badge:(plan.badge && i == plan.tiles - 1) ? more : 0];
    tile.frame = CGRectMake(0, y, kTileW, s.tileH);
    [self.column addSubview:tile];
    y += s.tileH + s.gap;
  }
  if (plan.pill) {
    UILabel *pill = [self labelWithText:[NSString stringWithFormat:@"+%ld", (long)more] font:(s.moreH >= 28 ? 14 : 12) color:UIColor.whiteColor frame:CGRectMake(0, y, kTileW, s.moreH) lines:1];
    pill.backgroundColor = TKHex(0x1E293B);
    pill.layer.cornerRadius = s.moreH / 2;
    pill.layer.masksToBounds = YES;
    pill.isAccessibilityElement = YES;
    pill.accessibilityLabel = [NSString stringWithFormat:@"+%ld", (long)more];
    [self.column addSubview:pill];
    y += s.moreH;
  } else {
    y -= s.gap;
  }
  self.columnHeight = y - kBadgePad;
}

- (UIView *)tileForItem:(NSDictionary *)item size:(TKSize)s badge:(NSInteger)badgeCount {
  NSString *type = item[@"type"];
  NSArray<NSNumber *> *tone = [HazardRailOverlayView tones][type] ?: [HazardRailOverlayView tones][@"accident"];
  NSString *emphasis = item[@"emphasis"];
  BOOL neutral = !([emphasis isEqualToString:@"strong"] || [emphasis isEqualToString:@"normal"]);
  UIColor *fill, *fg, *stroke;
  if ([emphasis isEqualToString:@"strong"]) { fill = TKHex(tone[2].unsignedIntValue); fg = UIColor.whiteColor; stroke = UIColor.whiteColor; }
  else if ([emphasis isEqualToString:@"normal"]) { fill = TKHex(tone[0].unsignedIntValue); fg = TKHex(tone[1].unsignedIntValue); stroke = fg; }
  else { fill = TKHex(0xE2E8F0); fg = TKHex(0x64748B); stroke = fg; }
  NSString *name = [self nameForItem:item];
  NSString *distance = [self distanceText:[item[@"distanceM"] integerValue]];

  UIView *tile = [[UIView alloc] initWithFrame:CGRectMake(0, 0, kTileW, s.tileH)];
  tile.clipsToBounds = NO;
  tile.backgroundColor = fill;
  tile.layer.cornerRadius = 12;
  if (neutral) {
    // 확정되지 않은(probable) 위험은 점선 테두리로 구분한다
    CAShapeLayer *dashed = [CAShapeLayer layer];
    dashed.frame = tile.bounds;
    dashed.path = [UIBezierPath bezierPathWithRoundedRect:CGRectInset(tile.bounds, 1, 1) cornerRadius:11].CGPath;
    dashed.fillColor = UIColor.clearColor.CGColor;
    dashed.strokeColor = stroke.CGColor;
    dashed.lineWidth = 2;
    dashed.lineDashPattern = @[@4, @3];
    [tile.layer addSublayer:dashed];
  } else {
    tile.layer.borderWidth = 2;
    tile.layer.borderColor = stroke.CGColor;
  }
  tile.isAccessibilityElement = YES;
  tile.accessibilityLabel = [NSString stringWithFormat:@"%@ %@", name, distance];

  // 위에서부터 아이콘 → 위험 유형 이름 → 거리
  CAShapeLayer *icon = [CAShapeLayer layer];
  icon.frame = CGRectMake((kTileW - s.icon) / 2, s.padTop, s.icon, s.icon);
  UIBezierPath *path = [TKHazardIconPath(type) copy];
  CGFloat scale = s.icon / 24.0;
  [path applyTransform:CGAffineTransformMakeScale(scale, scale)];
  icon.path = path.CGPath;
  icon.fillColor = nil;
  icon.strokeColor = fg.CGColor;
  icon.lineWidth = 2 * scale; // Lucide 기본 선 굵기 2(24 기준)
  icon.lineCap = kCALineCapRound;
  icon.lineJoin = kCALineJoinRound;
  [tile.layer addSublayer:icon];

  CGFloat nameY = s.padTop + s.icon + 2;
  [tile addSubview:[self labelWithText:name font:s.nameFont color:fg frame:CGRectMake(2, nameY, kTileW - 4, s.nameH) lines:s.lines]];
  [tile addSubview:[self labelWithText:distance font:s.distFont color:fg frame:CGRectMake(2, nameY + s.nameH + 1, kTileW - 4, s.distH) lines:1]];

  if (badgeCount > 0) {
    UILabel *badge = [self labelWithText:[NSString stringWithFormat:@"+%ld", (long)badgeCount] font:10 color:UIColor.whiteColor frame:CGRectMake(kTileW - 26, -6, 30, 18) lines:1];
    badge.backgroundColor = TKHex(0x1E293B);
    badge.layer.cornerRadius = 9;
    badge.layer.masksToBounds = YES;
    badge.layer.borderWidth = 1;
    badge.layer.borderColor = UIColor.whiteColor.CGColor;
    [tile addSubview:badge];
  }
  return tile;
}

@end

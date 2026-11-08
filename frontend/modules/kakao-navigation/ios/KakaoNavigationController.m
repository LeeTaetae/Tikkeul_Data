#import "KakaoNavigationController.h"
#import "CarVoiceSpeaker.h"
#import "CarVoiceText.h"
#import "HazardRailOverlayView.h"
#import <AVFoundation/AVFoundation.h>
#import <QuartzCore/QuartzCore.h>
#import <KNSDK/KNSDK.h>
#import <KNSDK/KNNaviView.h>
#import <math.h>

@interface KakaoNavigationController () <
  KNGuidance_GuideStateDelegate, KNGuidance_LocationGuideDelegate,
  KNGuidance_RouteGuideDelegate, KNGuidance_SafetyGuideDelegate,
  KNGuidance_VoiceGuideDelegate, KNGuidance_CitsGuideDelegate,
  KNNaviView_GuideStateDelegate>
@property(nonatomic, copy) NSDictionary *options;
@property(nonatomic, copy, nullable) void (^completion)(NSString * _Nullable, NSString * _Nullable);
@property(nonatomic, strong, nullable) KNNaviView *naviView;
@property(nonatomic, strong, nullable) KNGuidance *guidance;
@property(nonatomic) BOOL closed;
@property(nonatomic) BOOL started;
@property(nonatomic) BOOL previousIdleTimerDisabled;
@property(nonatomic, copy, nullable) NSString *previousAudioCategory;
@property(nonatomic, copy, nullable) NSString *previousAudioMode;
@property(nonatomic) AVAudioSessionCategoryOptions previousAudioOptions;
@property(nonatomic, strong, nullable) CarVoiceSpeaker *voiceSpeaker;
@property(nonatomic, copy) NSString *voiceLanguage;
@property(nonatomic) BOOL voiceFailureShown;
@property(nonatomic, strong, nullable) HazardRailOverlayView *railOverlay;
@property(nonatomic, strong, nullable) UILabel *weatherSafetyLabel;
@property(nonatomic, strong, nullable) UIScrollView *weatherSafetyPanel;
@property(nonatomic) CFTimeInterval lastLocationEmit;
@end

// 위험 레일: JS → 네이티브 스냅샷의 보관소. 오버레이가 아직 없을 때 온 마지막 스냅샷은 오버레이가 붙을 때 그려진다.
static const NSUInteger kMaxRailJSON = 16384;
static __weak KakaoNavigationController *sActiveController = nil;
static NSString *sLastRailJSON = nil;
static NSString *sLastWeatherText = nil;
static NSUInteger sWeatherGeneration = 0;

@implementation KakaoNavigationController

+ (void)setWeatherSafetyBanner:(NSString *)text {
  if (![text isKindOfClass:NSString.class] || text.length > 500) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    sLastWeatherText = [text copy];
    NSUInteger generation = ++sWeatherGeneration;
    if (![sActiveController.weatherSafetyLabel.text isEqualToString:text]) {
      [sActiveController.weatherSafetyPanel setContentOffset:CGPointZero animated:NO];
    }
    sActiveController.weatherSafetyLabel.text = text;
    sActiveController.weatherSafetyPanel.hidden = text.length == 0;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(20 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
      if (generation != sWeatherGeneration) return;
      sLastWeatherText = nil;
      sActiveController.weatherSafetyPanel.hidden = YES;
    });
  });
}

+ (void)setHazardRailJSON:(NSString *)json {
  if (![json isKindOfClass:NSString.class] || json.length > kMaxRailJSON) return;
  dispatch_async(dispatch_get_main_queue(), ^{
    sLastRailJSON = [json copy];
    [sActiveController.railOverlay applySnapshotJSON:json];
  });
}

+ (void)clearHazardRail {
  dispatch_async(dispatch_get_main_queue(), ^{
    sLastRailJSON = nil;
    [sActiveController.railOverlay applySnapshotJSON:nil];
  });
}

+ (NSDictionary *)configuration {
  NSString *key = [NSBundle.mainBundle objectForInfoDictionaryKey:@"KakaoNaviNativeAppKey"];
  return @{ @"configured": @([key isKindOfClass:NSString.class] && key.length > 0),
            @"sdkVersion": @"1.12.14", @"platform": @"ios" };
}

- (instancetype)initWithOptions:(NSDictionary *)options completion:(void (^)(NSString *, NSString *))completion {
  self = [super initWithNibName:nil bundle:nil];
  if (self) {
    _options = [options copy];
    _completion = [completion copy];
    NSString *language = [options[@"language"] isKindOfClass:NSString.class] ? options[@"language"] : @"ko";
    _voiceLanguage = [@[@"ko", @"en", @"zh"] containsObject:language] ? language : @"ko";
    __weak typeof(self) weakSelf = self;
    _voiceSpeaker = [[CarVoiceSpeaker alloc] initWithFailureHandler:^{
      dispatch_async(dispatch_get_main_queue(), ^{
        typeof(self) self = weakSelf;
        if (!self || self.closed || self.voiceFailureShown) return;
        self.voiceFailureShown = YES;
        NSString *message = [self.voiceLanguage isEqualToString:@"zh"]
          ? @"无法使用中文语音。请检查系统语音设置。"
          : @"English voice is unavailable. Check the system voice settings.";
        UIAlertController *alert = [UIAlertController alertControllerWithTitle:nil message:message preferredStyle:UIAlertControllerStyleAlert];
        [alert addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:nil]];
        [self presentViewController:alert animated:YES completion:nil];
      });
    }];
    [_voiceSpeaker setLanguage:_voiceLanguage];
  }
  return self;
}

- (void)viewDidLoad {
  [super viewDidLoad];
  self.view.backgroundColor = UIColor.systemBackgroundColor;
  UIActivityIndicatorView *spinner = [[UIActivityIndicatorView alloc] initWithActivityIndicatorStyle:UIActivityIndicatorViewStyleLarge];
  spinner.center = self.view.center;
  spinner.autoresizingMask = UIViewAutoresizingFlexibleTopMargin | UIViewAutoresizingFlexibleBottomMargin | UIViewAutoresizingFlexibleLeftMargin | UIViewAutoresizingFlexibleRightMargin;
  [self.view addSubview:spinner];
  [spinner startAnimating];
  UIButton *cancel = [UIButton buttonWithType:UIButtonTypeSystem];
  [cancel setTitle:@"취소" forState:UIControlStateNormal];
  [cancel addTarget:self action:@selector(cancelNavigation) forControlEvents:UIControlEventTouchUpInside];
  cancel.translatesAutoresizingMaskIntoConstraints = NO;
  [self.view addSubview:cancel];
  [NSLayoutConstraint activateConstraints:@[
    [cancel.centerXAnchor constraintEqualToAnchor:self.view.centerXAnchor],
    [cancel.bottomAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.bottomAnchor constant:-24],
    [cancel.heightAnchor constraintEqualToConstant:48],
    [cancel.widthAnchor constraintGreaterThanOrEqualToConstant:80]
  ]];
}

- (void)viewDidAppear:(BOOL)animated {
  [super viewDidAppear:animated];
  if (!self.started && !self.closed) {
    self.started = YES;
    [self beginNavigation];
  }
}

- (void)beginNavigation {
  NSSet *styles = [NSSet setWithArray:@[@"recommended", @"shortest", @"major_road", @"toll_free", @"avoid_school_zone"]];
  if (![styles containsObject:self.options[@"routeStyle"]]) {
    [self finishWithCode:@"INVALID_REQUEST" message:@"Invalid route option"];
    return;
  }
  for (NSString *key in @[@"originLatitude", @"originLongitude", @"destinationLatitude", @"destinationLongitude"]) {
    id value = self.options[key];
    double limit = [key containsString:@"Latitude"] ? 90.0 : 180.0;
    if (![value isKindOfClass:NSNumber.class] || !isfinite([value doubleValue]) || fabs([value doubleValue]) > limit) {
      [self finishWithCode:@"INVALID_REQUEST" message:@"Invalid navigation coordinates"];
      return;
    }
  }
  NSString *appKey = [NSBundle.mainBundle objectForInfoDictionaryKey:@"KakaoNaviNativeAppKey"];
  if (![appKey isKindOfClass:NSString.class] || !appKey.length) {
    [self finishWithCode:@"NOT_CONFIGURED" message:@"Native Kakao application key is missing"];
    return;
  }

  self.previousIdleTimerDisabled = UIApplication.sharedApplication.idleTimerDisabled;
  UIApplication.sharedApplication.idleTimerDisabled = YES;
  AVAudioSession *audio = AVAudioSession.sharedInstance;
  self.previousAudioCategory = audio.category;
  self.previousAudioMode = audio.mode;
  self.previousAudioOptions = audio.categoryOptions;
  NSError *audioError = nil;
  [audio setCategory:AVAudioSessionCategoryPlayback mode:AVAudioSessionModeDefault options:AVAudioSessionCategoryOptionMixWithOthers error:&audioError];
  if (!audioError) [audio setActive:YES error:&audioError];
  if (audioError) {
    [self finishWithCode:@"AUDIO_FAILED" message:@"Voice guidance audio is unavailable"];
    return;
  }

  NSNotificationCenter *notifications = NSNotificationCenter.defaultCenter;
  [notifications addObserver:self selector:@selector(willResignActive) name:UIApplicationWillResignActiveNotification object:nil];
  [notifications addObserver:self selector:@selector(didEnterBackground) name:UIApplicationDidEnterBackgroundNotification object:nil];
  [notifications addObserver:self selector:@selector(willEnterForeground) name:UIApplicationWillEnterForegroundNotification object:nil];
  [notifications addObserver:self selector:@selector(didBecomeActive) name:UIApplicationDidBecomeActiveNotification object:nil];

  NSString *installationId = [NSUserDefaults.standardUserDefaults stringForKey:@"tikkeul-kakao-navigation-installation-id"];
  if (!installationId) {
    installationId = NSUUID.UUID.UUIDString;
    [NSUserDefaults.standardUserDefaults setObject:installationId forKey:@"tikkeul-kakao-navigation-installation-id"];
  }
  KNSDK *sdk = KNSDK.sharedInstance;
  if (!sdk) {
    [self finishWithCode:@"SDK_INIT_FAILED" message:@"Kakao SDK is unavailable"];
    return;
  }
  [sdk setAppUserId:installationId];
  static NSString *authenticatedKey = nil;
  if ([authenticatedKey isEqualToString:appKey]) {
    [self requestTrip];
    return;
  }
  NSString *version = [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"] ?: @"1.0.0";
  __weak typeof(self) weakSelf = self;
  [sdk initializeWithAppKey:appKey clientVersion:version completion:^(KNError *error) {
    dispatch_async(dispatch_get_main_queue(), ^{
      typeof(self) self = weakSelf;
      if (!self || self.closed) return;
      if (error) [self finishWithCode:@"SDK_AUTH_FAILED" message:@"Kakao SDK authentication failed"];
      else { authenticatedKey = [appKey copy]; [self requestTrip]; }
    });
  }];
}

- (KNPOI *)poiWithName:(NSString *)name longitude:(NSNumber *)longitude latitude:(NSNumber *)latitude {
  IntPoint point = [KNSDK.sharedInstance convertWGS84ToKATECWithLongitude:longitude.doubleValue latitude:latitude.doubleValue];
  return [[KNPOI alloc] initWithName:name pos:point];
}

- (void)requestTrip {
  KNPOI *start = [self poiWithName:@"출발지" longitude:self.options[@"originLongitude"] latitude:self.options[@"originLatitude"]];
  NSString *label = [self.options[@"destinationLabel"] isKindOfClass:NSString.class] ? self.options[@"destinationLabel"] : @"목적지";
  KNPOI *goal = [self poiWithName:label.length ? label : @"목적지" longitude:self.options[@"destinationLongitude"] latitude:self.options[@"destinationLatitude"]];
  __weak typeof(self) weakSelf = self;
  [KNSDK.sharedInstance makeTripWithStart:start goal:goal vias:nil completion:^(KNError *error, KNTrip *trip) {
    dispatch_async(dispatch_get_main_queue(), ^{
      typeof(self) self = weakSelf;
      if (!self || self.closed) return;
      if (error || !trip) [self finishWithCode:@"ROUTE_FAILED" message:@"Kakao route calculation failed"];
      else [self routeTrip:trip];
    });
  }];
}

- (void)routeTrip:(KNTrip *)trip {
  NSString *style = self.options[@"routeStyle"];
  KNRoutePriority priority = KNRoutePriority_Recommand;
  if ([style isEqualToString:@"shortest"]) priority = KNRoutePriority_Distance;
  if ([style isEqualToString:@"major_road"]) priority = KNRoutePriority_WideWay;
  SInt32 avoid = KNRouteAvoidOption_None;
  if ([style isEqualToString:@"toll_free"]) avoid = KNRouteAvoidOption_Fare;
  if ([style isEqualToString:@"avoid_school_zone"]) avoid = KNRouteAvoidOption_SZone;
  __weak typeof(self) weakSelf = self;
  [trip routeWithPriority:priority avoidOptions:avoid completion:^(KNError *error, NSArray<KNRoute *> *routes) {
    dispatch_async(dispatch_get_main_queue(), ^{
      typeof(self) self = weakSelf;
      if (!self || self.closed) return;
      if (error) { [self finishWithCode:@"ROUTE_FAILED" message:@"Kakao route request failed"]; return; }
      self.guidance = KNSDK.sharedInstance.sharedGuidance;
      if (!self.guidance) { [self finishWithCode:@"GUIDANCE_UNAVAILABLE" message:@"Kakao guidance is unavailable"]; return; }
      self.guidance.guideStateDelegate = self;
      self.guidance.locationGuideDelegate = self;
      self.guidance.routeGuideDelegate = self;
      self.guidance.safetyGuideDelegate = self;
      self.guidance.voiceGuideDelegate = self;
      self.guidance.citsGuideDelegate = self;
      self.naviView = [[KNNaviView alloc] initWithGuidance:self.guidance trip:trip routeOption:priority avoidOption:avoid];
      self.naviView.guideStateDelegate = self;
      self.naviView.translatesAutoresizingMaskIntoConstraints = NO;
      for (UIView *child in self.view.subviews) [child removeFromSuperview];
      [self.view addSubview:self.naviView];
      [NSLayoutConstraint activateConstraints:@[
        [self.naviView.topAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.topAnchor],
        [self.naviView.bottomAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.bottomAnchor],
        [self.naviView.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],
        [self.naviView.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor]
      ]];
      [self.naviView sndVolume:1.0];
      // 위험 레일: JS 가 보낸 스냅샷을 왼쪽에 그린다. 실패해도 길안내를 막지 않는다.
      self.railOverlay = [[HazardRailOverlayView alloc] initWithLanguage:self.voiceLanguage];
      [self.railOverlay attachToHost:self.view naviView:self.naviView];
      self.weatherSafetyLabel = [UILabel new];
      self.weatherSafetyLabel.translatesAutoresizingMaskIntoConstraints = NO;
      self.weatherSafetyLabel.numberOfLines = 0;
      self.weatherSafetyLabel.font = [UIFont boldSystemFontOfSize:15];
      self.weatherSafetyLabel.textColor = [UIColor colorWithRed:0.2 green:0.16 blue:0.08 alpha:1];
      self.weatherSafetyLabel.backgroundColor = [UIColor colorWithRed:1 green:0.98 blue:0.90 alpha:1];
      self.weatherSafetyLabel.layer.cornerRadius = 12;
      self.weatherSafetyLabel.clipsToBounds = YES;
      self.weatherSafetyLabel.userInteractionEnabled = NO;
      self.weatherSafetyLabel.text = sLastWeatherText;
      self.weatherSafetyPanel = [UIScrollView new];
      self.weatherSafetyPanel.translatesAutoresizingMaskIntoConstraints = NO;
      self.weatherSafetyPanel.backgroundColor = self.weatherSafetyLabel.backgroundColor;
      self.weatherSafetyPanel.layer.cornerRadius = 12;
      self.weatherSafetyPanel.hidden = sLastWeatherText.length == 0;
      [self.weatherSafetyPanel addSubview:self.weatherSafetyLabel];
      [self.view addSubview:self.weatherSafetyPanel];
      NSLayoutConstraint *contentHeight = [self.weatherSafetyPanel.heightAnchor constraintEqualToAnchor:self.weatherSafetyLabel.heightAnchor constant:20];
      contentHeight.priority = UILayoutPriorityDefaultHigh;
      [NSLayoutConstraint activateConstraints:@[
        [self.weatherSafetyPanel.topAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.topAnchor constant:96],
        [self.weatherSafetyPanel.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor constant:16],
        [self.weatherSafetyPanel.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor constant:-16],
        [self.weatherSafetyPanel.heightAnchor constraintLessThanOrEqualToAnchor:self.view.safeAreaLayoutGuide.heightAnchor multiplier:0.30],
        contentHeight,
        [self.weatherSafetyLabel.topAnchor constraintEqualToAnchor:self.weatherSafetyPanel.contentLayoutGuide.topAnchor constant:10],
        [self.weatherSafetyLabel.bottomAnchor constraintEqualToAnchor:self.weatherSafetyPanel.contentLayoutGuide.bottomAnchor constant:-10],
        [self.weatherSafetyLabel.leadingAnchor constraintEqualToAnchor:self.weatherSafetyPanel.contentLayoutGuide.leadingAnchor constant:12],
        [self.weatherSafetyLabel.trailingAnchor constraintEqualToAnchor:self.weatherSafetyPanel.contentLayoutGuide.trailingAnchor constant:-12],
        [self.weatherSafetyLabel.widthAnchor constraintEqualToAnchor:self.weatherSafetyPanel.frameLayoutGuide.widthAnchor constant:-24]
      ]];
      self.railOverlay.topAvoidView = self.weatherSafetyPanel; // 단계 안내 배너는 날씨 안내 아래에 놓는다
      sActiveController = self;
      if (sLastRailJSON) [self.railOverlay applySnapshotJSON:sLastRailJSON];
    });
  }];
}

- (void)finishWithCode:(NSString *)code message:(NSString *)message {
  if (self.closed) return;
  self.closed = YES;
  [self.voiceSpeaker stop];
  [self.railOverlay detach];
  self.railOverlay = nil;
  if (sActiveController == self) { sActiveController = nil; sLastRailJSON = nil; sLastWeatherText = nil; } // 다음 주행에 지난 위험이 남지 않게
  [self.weatherSafetyPanel removeFromSuperview];
  self.weatherSafetyPanel = nil;
  self.weatherSafetyLabel = nil;
  self.eventHandler = nil;
  [NSNotificationCenter.defaultCenter removeObserver:self];
  self.naviView.guideStateDelegate = nil;
  self.guidance.guideStateDelegate = nil;
  self.guidance.locationGuideDelegate = nil;
  self.guidance.routeGuideDelegate = nil;
  self.guidance.safetyGuideDelegate = nil;
  self.guidance.voiceGuideDelegate = nil;
  self.guidance.citsGuideDelegate = nil;
  [self.guidance stop];
  [self.naviView pauseView];
  [self.naviView releaseView];
  if (self.previousAudioCategory) {
    AVAudioSession *audio = AVAudioSession.sharedInstance;
    [audio setActive:NO withOptions:AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation error:nil];
    [audio setCategory:self.previousAudioCategory mode:self.previousAudioMode options:self.previousAudioOptions error:nil];
    UIApplication.sharedApplication.idleTimerDisabled = self.previousIdleTimerDisabled;
  }
  void (^complete)(void) = ^{
    if (self.completion) self.completion(code, message);
    self.completion = nil;
  };
  if (self.presentingViewController) [self dismissViewControllerAnimated:YES completion:complete];
  else complete();
}

- (void)cancelNavigation { [self finishWithCode:nil message:nil]; }
- (void)willResignActive { [KNSDK handleWillResignActive]; [self.naviView pauseView]; }
- (void)didEnterBackground { [KNSDK handleDidEnterBackground]; }
- (void)willEnterForeground { [KNSDK handleWillEnterForeground]; }
- (void)didBecomeActive { [KNSDK handleDidBecomeActive]; [self.naviView resumeView]; }
- (void)dealloc { [NSNotificationCenter.defaultCenter removeObserver:self]; }
- (void)naviViewGuideState:(KNGuideState)state {}
- (void)naviViewGuideEnded:(KNNaviView *)view { [self finishWithCode:nil message:nil]; }

- (void)guidanceGuideStarted:(KNGuidance *)g { [self.naviView guidanceGuideStarted:g]; [self emitRoute:@"started" route:g.routesOnGuide.firstObject]; }
- (void)guidanceCheckingRouteChange:(KNGuidance *)g { [self.naviView guidanceCheckingRouteChange:g]; }
- (void)guidanceOutOfRoute:(KNGuidance *)g { [self.naviView guidanceOutOfRoute:g]; }
- (void)guidanceRouteUnchanged:(KNGuidance *)g { [self.naviView guidanceRouteUnchanged:g]; }
- (void)guidance:(KNGuidance *)g routeUnchangedWithError:(KNError *)error { [self.naviView guidance:g routeUnchangedWithError:error]; }
- (void)guidanceRouteChanged:(KNGuidance *)g fromRoute:(KNRoute *)fromRoute fromLocation:(KNLocation *)fromLocation toRoute:(KNRoute *)toRoute toLocation:(KNLocation *)toLocation reason:(KNGuideRouteChangeReason)reason { [self.voiceSpeaker stop]; [self.naviView guidanceRouteChanged:g]; [self emitRoute:@"changed" route:toRoute]; }
- (void)guidanceGuideEnded:(KNGuidance *)g { [self.naviView guidanceGuideEnded:g isShowDriveResultDialog:YES]; }
- (void)guidance:(KNGuidance *)g didUpdateRoutes:(NSArray<KNRoute *> *)routes multiRouteInfo:(KNMultiRouteInfo *)info { [self.naviView guidance:g didUpdateRoutes:routes multiRouteInfo:info]; }
- (void)guidance:(KNGuidance *)g didUpdateIndoorRoute:(KNRoute *)route { if (route) [self.naviView guidance:g didUpdateIndoorRoute:route]; }
- (void)guidance:(KNGuidance *)g didUpdateLocation:(KNGuide_Location *)location { [self.naviView guidance:g didUpdateLocation:location]; [self emitLocation:location]; }
- (void)guidance:(KNGuidance *)g didUpdateRouteGuide:(KNGuide_Route *)route { [self.naviView guidance:g didUpdateRouteGuide:route]; }
- (void)guidance:(KNGuidance *)g didUpdateSafetyGuide:(KNGuide_Safety *)safety { [self.naviView guidance:g didUpdateSafetyGuide:safety]; }
- (void)guidance:(KNGuidance *)g didUpdateAroundSafeties:(NSArray<KNSafety *> *)safeties { [self.naviView guidance:g didUpdateAroundSafeties:safeties]; }
- (BOOL)guidance:(KNGuidance *)g shouldPlayVoiceGuide:(KNGuide_Voice *)voice replaceSndData:(NSData **)data {
  BOOL allowed = [self.naviView guidance:g shouldPlayVoiceGuide:voice replaceSndData:data];
  if ([self.voiceLanguage isEqualToString:@"ko"] || !allowed) return allowed;
  NSString *text = KNCarVoiceText(self.voiceLanguage, voice);
  if (text) [self.voiceSpeaker speak:text];
  // Non-verbal tones (alarm/alert/link sound) stay on the SDK; every spoken voice event is replaced above.
  return voice.voiceCode == KNVoiceCode_Alram || voice.voiceCode == KNVoiceCode_Alert || voice.voiceCode == KNVoiceCode_LinkSound;
}
- (void)guidance:(KNGuidance *)g willPlayVoiceGuide:(KNGuide_Voice *)voice { [self.naviView guidance:g willPlayVoiceGuide:voice]; }
- (void)guidance:(KNGuidance *)g didFinishPlayVoiceGuide:(KNGuide_Voice *)voice { [self.naviView guidance:g didFinishPlayVoiceGuide:voice]; }
- (void)guidance:(KNGuidance *)g didUpdateCitsGuide:(KNGuide_Cits *)cits { [self.naviView guidance:g didUpdateCitsGuide:cits]; }

// ── 위험 레일용 이벤트: SDK 의 위치·경로를 JS 위험 로직으로 넘긴다 ──────────────────────────
// 좌표는 앱 안(JS)에서만 쓰이고 로그에 남기지 않는다. 위치는 1초에 한 번, 경로는 시작·재탐색 때만 보낸다.
- (void)emitLocation:(KNGuide_Location *)location {
  if (!self.eventHandler || self.closed) return;
  CFTimeInterval now = CACurrentMediaTime();
  if (now - self.lastLocationEmit < 1.0) return;
  KNGPSData *gps = location.gpsMatched;
  if (!gps) return;
  self.lastLocationEmit = now;
  DoublePoint p = [KNSDK.sharedInstance convertKATECToWGS84WithX:(SInt32)llround(gps.pos.x) y:(SInt32)llround(gps.pos.y)]; // x: 경도, y: 위도
  self.eventHandler(@{ @"kind": @"location", @"lat": @(p.y), @"lng": @(p.x), @"speedKmh": @(gps.speed), @"angle": @(gps.angle),
                       @"hdop": @(gps.hdop), @"posTrust": @(gps.posTrust), @"valid": @(gps.valid),
                       // The public iOS KNGPSData contract exposes no measurement date.
                       // JS reuses the existing Expo GPS measurement; never substitute callback time.
                       @"timestampMs": [NSNull null], @"timestampSource": @"unavailable" });
}

- (void)emitRoute:(NSString *)reason route:(KNRoute * _Nullable)route {
  if (!self.eventHandler || self.closed || !route) return;
  NSArray *polyline = [route routePolylineWGS84];
  NSMutableArray *points = [NSMutableArray arrayWithCapacity:MIN(polyline.count, 6000)];
  for (id element in polyline) {
    if (points.count >= 6000) break;
    double lng = NAN, lat = NAN;
    // 원소 형식을 헤더가 정하지 않아(@see DoublePoint) 흔한 모양을 모두 받는다: NSValue(DoublePoint/CGPoint), 딕셔너리, [경도, 위도]
    if ([element isKindOfClass:NSValue.class]) {
      NSValue *value = element;
      const char *type = value.objCType;
      if (strcmp(type, @encode(DoublePoint)) == 0) { DoublePoint dp; [value getValue:&dp]; lng = dp.x; lat = dp.y; }
      else if (strncmp(type, "{CGPoint", 8) == 0) { CGPoint cp = value.CGPointValue; lng = cp.x; lat = cp.y; }
    } else if ([element isKindOfClass:NSDictionary.class]) {
      id x = element[@"x"] ?: element[@"lng"] ?: element[@"lon"];
      id y = element[@"y"] ?: element[@"lat"];
      if ([x respondsToSelector:@selector(doubleValue)] && [y respondsToSelector:@selector(doubleValue)]) { lng = [x doubleValue]; lat = [y doubleValue]; }
    } else if ([element isKindOfClass:NSArray.class] && [element count] >= 2) {
      lng = [element[0] doubleValue]; lat = [element[1] doubleValue];
    }
    if (isfinite(lng) && isfinite(lat)) [points addObject:@{ @"x": @(lng), @"y": @(lat) }];
  }
  if (points.count < 2) return;
  self.eventHandler(@{ @"kind": @"route", @"reason": reason, @"count": @(polyline.count), @"keys": @[@"x", @"y"], @"points": points });
}
@end

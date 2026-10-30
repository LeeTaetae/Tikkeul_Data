#import "KakaoNavigationController.h"
#import <AVFoundation/AVFoundation.h>
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
@end

@implementation KakaoNavigationController

+ (NSDictionary *)configuration {
  NSString *key = [NSBundle.mainBundle objectForInfoDictionaryKey:@"KakaoNaviNativeAppKey"];
  return @{ @"configured": @([key isKindOfClass:NSString.class] && key.length > 0),
            @"sdkVersion": @"1.12.14", @"platform": @"ios" };
}

- (instancetype)initWithOptions:(NSDictionary *)options completion:(void (^)(NSString *, NSString *))completion {
  self = [super initWithNibName:nil bundle:nil];
  if (self) { _options = [options copy]; _completion = [completion copy]; }
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
    });
  }];
}

- (void)finishWithCode:(NSString *)code message:(NSString *)message {
  if (self.closed) return;
  self.closed = YES;
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

- (void)guidanceGuideStarted:(KNGuidance *)g { [self.naviView guidanceGuideStarted:g]; }
- (void)guidanceCheckingRouteChange:(KNGuidance *)g { [self.naviView guidanceCheckingRouteChange:g]; }
- (void)guidanceOutOfRoute:(KNGuidance *)g { [self.naviView guidanceOutOfRoute:g]; }
- (void)guidanceRouteUnchanged:(KNGuidance *)g { [self.naviView guidanceRouteUnchanged:g]; }
- (void)guidance:(KNGuidance *)g routeUnchangedWithError:(KNError *)error { [self.naviView guidance:g routeUnchangedWithError:error]; }
- (void)guidanceRouteChanged:(KNGuidance *)g fromRoute:(KNRoute *)fromRoute fromLocation:(KNLocation *)fromLocation toRoute:(KNRoute *)toRoute toLocation:(KNLocation *)toLocation reason:(KNGuideRouteChangeReason)reason { [self.naviView guidanceRouteChanged:g]; }
- (void)guidanceGuideEnded:(KNGuidance *)g { [self.naviView guidanceGuideEnded:g isShowDriveResultDialog:YES]; }
- (void)guidance:(KNGuidance *)g didUpdateRoutes:(NSArray<KNRoute *> *)routes multiRouteInfo:(KNMultiRouteInfo *)info { [self.naviView guidance:g didUpdateRoutes:routes multiRouteInfo:info]; }
- (void)guidance:(KNGuidance *)g didUpdateIndoorRoute:(KNRoute *)route { if (route) [self.naviView guidance:g didUpdateIndoorRoute:route]; }
- (void)guidance:(KNGuidance *)g didUpdateLocation:(KNGuide_Location *)location { [self.naviView guidance:g didUpdateLocation:location]; }
- (void)guidance:(KNGuidance *)g didUpdateRouteGuide:(KNGuide_Route *)route { [self.naviView guidance:g didUpdateRouteGuide:route]; }
- (void)guidance:(KNGuidance *)g didUpdateSafetyGuide:(KNGuide_Safety *)safety { [self.naviView guidance:g didUpdateSafetyGuide:safety]; }
- (void)guidance:(KNGuidance *)g didUpdateAroundSafeties:(NSArray<KNSafety *> *)safeties { [self.naviView guidance:g didUpdateAroundSafeties:safeties]; }
- (BOOL)guidance:(KNGuidance *)g shouldPlayVoiceGuide:(KNGuide_Voice *)voice replaceSndData:(NSData **)data { return [self.naviView guidance:g shouldPlayVoiceGuide:voice replaceSndData:data]; }
- (void)guidance:(KNGuidance *)g willPlayVoiceGuide:(KNGuide_Voice *)voice { [self.naviView guidance:g willPlayVoiceGuide:voice]; }
- (void)guidance:(KNGuidance *)g didFinishPlayVoiceGuide:(KNGuide_Voice *)voice { [self.naviView guidance:g didFinishPlayVoiceGuide:voice]; }
- (void)guidance:(KNGuidance *)g didUpdateCitsGuide:(KNGuide_Cits *)cits { [self.naviView guidance:g didUpdateCitsGuide:cits]; }
@end

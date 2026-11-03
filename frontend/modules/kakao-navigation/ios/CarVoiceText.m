#import "CarVoiceText.h"

static NSString *Words(NSString *language, NSString *en, NSString *zh) {
  return [language isEqualToString:@"zh"] ? zh : en;
}

static NSString *ManeuverWords(NSString *language, KNRGCode code) {
  NSInteger raw = (NSInteger)code;
  if (raw >= KNRGCode_Direction_1 && raw <= KNRGCode_Direction_12) {
    NSInteger clock = raw - KNRGCode_Direction_1 + 1;
    return [NSString stringWithFormat:Words(language, @"Head in the %ld o'clock direction", @"向%ld点钟方向行驶"), (long)clock];
  }
  if (raw >= KNRGCode_RoundaboutDirection_1 && raw <= KNRGCode_RoundaboutDirection_12) {
    NSInteger clock = raw - KNRGCode_RoundaboutDirection_1 + 1;
    return [NSString stringWithFormat:Words(language, @"At the roundabout, take the exit at %ld o'clock", @"在环岛从%ld点钟方向驶出"), (long)clock];
  }
  switch (code) {
    case KNRGCode_Start: return Words(language, @"Start along the route", @"沿路线出发");
    case KNRGCode_Goal: return Words(language, @"Arrive at your destination", @"到达目的地");
    case KNRGCode_Via: return Words(language, @"Reach the waypoint", @"到达途经点");
    case KNRGCode_Straight: return Words(language, @"Continue straight", @"直行");
    case KNRGCode_LeftTurn: return Words(language, @"Turn left", @"左转");
    case KNRGCode_UnprotectedLeftTurn: return Words(language, @"Turn left when safe. Yield to oncoming traffic", @"确认安全后左转，请让对向车辆先行");
    case KNRGCode_RightTurn: return Words(language, @"Turn right", @"右转");
    case KNRGCode_UTurn: return Words(language, @"Make a U-turn", @"掉头");
    case KNRGCode_LeftDirection:
    case KNRGCode_LeftStraight: return Words(language, @"Keep left", @"靠左行驶");
    case KNRGCode_RightDirection:
    case KNRGCode_RightStraight: return Words(language, @"Keep right", @"靠右行驶");
    case KNRGCode_OutHighway:
    case KNRGCode_OutCityway: return Words(language, @"Take the exit", @"驶出快速道路");
    case KNRGCode_LeftOutHighway:
    case KNRGCode_LeftOutCityway: return Words(language, @"Take the exit on the left", @"从左侧出口驶出");
    case KNRGCode_RightOutHighway:
    case KNRGCode_RightOutCityway: return Words(language, @"Take the exit on the right", @"从右侧出口驶出");
    case KNRGCode_InHighway:
    case KNRGCode_InCityway: return Words(language, @"Enter the expressway", @"驶入快速道路");
    case KNRGCode_LeftInHighway:
    case KNRGCode_LeftInCityway: return Words(language, @"Enter the expressway on the left", @"从左侧驶入快速道路");
    case KNRGCode_RightInHighway:
    case KNRGCode_RightInCityway: return Words(language, @"Enter the expressway on the right", @"从右侧驶入快速道路");
    case KNRGCode_ChangeLeftHighway: return Words(language, @"Take the connecting road on the left", @"走左侧连接道路");
    case KNRGCode_ChangeRightHighway: return Words(language, @"Take the connecting road on the right", @"走右侧连接道路");
    case KNRGCode_OverPath:
    case KNRGCode_LeftOverPath:
    case KNRGCode_RightOverPath: return Words(language, @"Take the overpass", @"走高架道路");
    case KNRGCode_UnderPath:
    case KNRGCode_LeftUnderPath:
    case KNRGCode_RightUnderPath: return Words(language, @"Take the underpass", @"走地下通道");
    case KNRGCode_Tunnel:
    case KNRGCode_LeftTunnel:
    case KNRGCode_RightTunnel: return Words(language, @"Enter the tunnel", @"进入隧道");
    case KNRGCode_OverPathSide:
    case KNRGCode_UnderPathSide:
    case KNRGCode_TunnelSide:
    case KNRGCode_LeftOverPathSide:
    case KNRGCode_RightOverPathSide:
    case KNRGCode_LeftUnderPathSide:
    case KNRGCode_RightUnderPathSide:
    case KNRGCode_LeftTunnelSide:
    case KNRGCode_RightTunnelSide: return Words(language, @"Take the road alongside, following the map", @"按照地图沿旁侧道路行驶");
    case KNRGCode_Tollgate:
    case KNRGCode_NonstopTollgate: return Words(language, @"Approach the tollgate", @"通过收费站");
    case KNRGCode_JoinAfterBranch: return Words(language, @"Merge along the route", @"沿路线汇入道路");
    case KNRGCode_InFerry: return Words(language, @"Board the ferry", @"驶入渡轮");
    case KNRGCode_OutFerry: return Words(language, @"Leave the ferry", @"驶离渡轮");
    case KNRGCode_IndoorEnterance: return Words(language, @"Enter the parking facility", @"进入停车场");
    case KNRGCode_IndoorExit: return Words(language, @"Exit the parking facility", @"驶出停车场");
    case KNRGCode_IndoorToUpFloor: return Words(language, @"Go up to the next level", @"前往上一层");
    case KNRGCode_IndoorToDownFloor: return Words(language, @"Go down to the next level", @"前往下一层");
    default: return Words(language, @"Follow the route shown on the map", @"请按照地图所示路线行驶");
  }
}

static NSString *HazardWords(NSString *language, KNSafetyCode code) {
  switch (code) {
    case KNSafetyCode_SpeedViolationCamera:
    case KNSafetyCode_MovableSpeedViolationCamera:
    case KNSafetyCode_SignalAndSpeedViolationCamera:
    case KNSafetyCode_SignalViolationCamera:
    case KNSafetyCode_LaneAndSpeedViolationCamera:
    case KNSafetyCode_BuslaneViolationCamera:
    case KNSafetyCode_BuslaneAndSpeedViolationCamera:
    case KNSafetyCode_OverloadViolationCamera:
    case KNSafetyCode_ParkingViolationCamera:
    case KNSafetyCode_CargoViolationCamera:
    case KNSafetyCode_ShoulderLaneViolationCamera:
    case KNSafetyCode_CutInViolationCamera:
    case KNSafetyCode_DrivingLaneViolationCamera:
    case KNSafetyCode_SpeedViolationBackwardCamera:
    case KNSafetyCode_SignalAndSpeedViolationBackwardCamera:
    case KNSafetyCode_OldDieselCamera:
    case KNSafetyCode_SeatBeltViolationCamera:
    case KNSafetyCode_TrafficColectionCamera:
    case KNSafetyCode_ViolationCamera:
    case KNSafetyCode_SpeedViolationSectionInCamera:
    case KNSafetyCode_SpeedViolationSectionOutCamera:
    case KNSafetyCode_SpeedViolationSectionInBackwardCamera:
    case KNSafetyCode_SpeedViolationSectionOutBackwardCamera:
    case KNSafetyCode_SpeedViolationSectionInOnlyCamera:
    case KNSafetyCode_SpeedViolationSectionOutOnlyCamera:
    case KNSafetyCode_SpeedViolationSectionInOnlyBackwardCamera:
    case KNSafetyCode_SpeedViolationSectionOutOnlyBackwardCamera:
    case KNSafetyCode_SpeedViolationSection:
    case KNSafetyCode_SpeedViolationSectionHalf:
      return Words(language, @"Traffic enforcement camera ahead. Observe the posted restrictions", @"前方交通执法摄像头，请遵守道路限速和交通规则");
    case KNSafetyCode_ChildrenProtectionZone:
    case KNSafetyCode_ChildrenAccidentPos:
      return Words(language, @"Children's safety zone ahead. Drive carefully", @"前方儿童安全区域，请谨慎驾驶");
    case KNSafetyCode_Hump:
      return Words(language, @"Speed bump ahead", @"前方减速带");
    case KNSafetyCode_SharpTurnSection:
      return Words(language, @"Sharp bend ahead", @"前方急弯");
    case KNSafetyCode_FrozenRoad:
    case KNSafetyCode_FrozenRoadLive:
    case KNSafetyCode_SlippingRoad:
      return Words(language, @"Slippery road ahead", @"前方路面湿滑");
    case KNSafetyCode_FogArea:
    case KNSafetyCode_FogAreaLive:
      return Words(language, @"Fog ahead. Drive carefully", @"前方有雾，请谨慎驾驶");
    case KNSafetyCode_RailroadCrossing:
      return Words(language, @"Railroad crossing ahead", @"前方铁路道口");
    case KNSafetyCode_FallingRocksArea:
      return Words(language, @"Falling rocks area ahead", @"前方落石区域");
    case KNSafetyCode_RoadNarrows:
      return Words(language, @"Road narrows ahead", @"前方道路变窄");
    case KNSafetyCode_SteepDownhillSection:
      return Words(language, @"Steep descent ahead", @"前方陡坡下行");
    case KNSafetyCode_AnimalsAppearingCaution:
      return Words(language, @"Watch for animals crossing", @"注意动物穿行");
    case KNSafetyCode_UnderPassFlood:
      return Words(language, @"Flood risk ahead", @"前方有积水风险");
    case KNSafetyCode_TrafficAccidentPos:
    case KNSafetyCode_CarAccidentPos:
    case KNSafetyCode_PedestrianAccidentPos:
    case KNSafetyCode_IntentTrfficAccident:
    case KNSafetyCode_DrowsyDrivingAccidentPos:
      return Words(language, @"Accident-prone area ahead. Drive carefully", @"前方事故多发区域，请谨慎驾驶");
    case KNSafetyCode_HeightLimitPos:
      return Words(language, @"Height restriction ahead. Check the posted limit", @"前方限高，请注意限高标志");
    case KNSafetyCode_WeightLimitPos:
      return Words(language, @"Weight restriction ahead. Check the posted limit", @"前方限重，请注意限重标志");
    default:
      return Words(language, @"Road safety caution ahead. Check the navigation display", @"前方道路安全提醒，请查看导航画面");
  }
}

NSString *_Nullable KNCarVoiceText(NSString *language, KNGuide_Voice *voice) {
  NSString *action = nil;
  switch (voice.voiceCode) {
    case KNVoiceCode_Turn: {
      KNDirection *direction = [voice.guideObj isKindOfClass:KNDirection.class] ? (KNDirection *)voice.guideObj : nil;
      action = direction ? ManeuverWords(language, direction.rgCode) : Words(language, @"Follow the route shown on the map", @"请按照地图所示路线行驶");
      break;
    }
    case KNVoiceCode_Safety: {
      KNSafety *safety = [voice.guideObj isKindOfClass:KNSafety.class] ? (KNSafety *)voice.guideObj : nil;
      action = safety ? HazardWords(language, safety.code) : Words(language, @"Road safety caution ahead. Check the navigation display", @"前方道路安全提醒，请查看导航画面");
      break;
    }
    case KNVoiceCode_StartGuide: action = Words(language, @"Starting route guidance", @"开始导航"); break;
    case KNVoiceCode_EndGuide: action = Words(language, @"Route guidance has ended", @"导航已结束"); break;
    case KNVoiceCode_CheckingRouteChange: action = Words(language, @"Checking the route", @"正在检查路线"); break;
    case KNVoiceCode_RouteChanged: action = Words(language, @"The route has been updated", @"路线已更新"); break;
    case KNVoiceCode_RouteUnchanged: action = Words(language, @"Continue on the current route", @"请继续按照当前路线行驶"); break;
    case KNVoiceCode_OutOfRoute: action = Words(language, @"You are off the route. Recalculating", @"已偏离路线，正在重新规划"); break;
    case KNVoiceCode_GPSConnected: action = Words(language, @"GPS signal restored", @"GPS信号已恢复"); break;
    case KNVoiceCode_SchoolZone: action = Words(language, @"School zone. Drive carefully", @"前方学校区域，请谨慎驾驶"); break;
    case KNVoiceCode_Hipass: action = Words(language, @"Electronic toll collection lane ahead", @"前方电子收费车道"); break;
    case KNVoiceCode_BusLaneGuide: action = Words(language, @"Watch for the bus lane restrictions", @"请注意公交专用车道限制"); break;
    case KNVoiceCode_StrateToNext: action = Words(language, @"Continue ahead along the route", @"请沿路线继续前行"); break;
    case KNVoiceCode_DetalDir:
    case KNVoiceCode_MultiRoute: action = Words(language, @"Check the lane and direction shown on the map", @"请注意地图所示车道和方向"); break;
    // Nonverbal tones remain SDK audio; they carry no Korean speech.
    case KNVoiceCode_Alram:
    case KNVoiceCode_Alert:
    case KNVoiceCode_LinkSound:
    default: action = nil; break;
  }
  if (!action) return nil;
  if (voice.voiceCode != KNVoiceCode_Turn) {
    return [action stringByAppendingString:@"."];
  }
  BOOL zh = [language isEqualToString:@"zh"];
  BOOL atPosition = voice.voiceDist == KNVoiceDist_AtPos;
  if (zh) {
    return [NSString stringWithFormat:@"%@%@。", atPosition ? @"现在，" : @"前方，", action];
  }
  NSString *lowerFirst = action.length > 0
    ? [[action substringToIndex:1].lowercaseString stringByAppendingString:[action substringFromIndex:1]]
    : action;
  return [NSString stringWithFormat:@"%@%@.", atPosition ? @"Now, " : @"Ahead, ", lowerFirst];
}

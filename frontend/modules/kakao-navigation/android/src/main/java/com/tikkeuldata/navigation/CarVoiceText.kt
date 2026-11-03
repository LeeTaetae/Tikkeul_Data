package com.tikkeuldata.navigation

// SDK event identifiers only: never translate or speak Korean node/road names as foreign speech.
internal object CarVoiceText {
  fun text(language: String, event: String, turn: String? = null, safety: String? = null, atPosition: Boolean = false): String? {
    fun words(en: String, zh: String) = if (language == "zh") zh else en
    val action = when (event.removePrefix("KNVoiceCode_")) {
      "Turn" -> turn?.let { maneuver(language, it.removePrefix("KNRGCode_")) } ?: words("Follow the route shown on the map", "请按照地图所示路线行驶")
      "Safety" -> hazard(language, safety.orEmpty().removePrefix("KNSafetyCode_"))
      "StartGuide" -> words("Starting route guidance", "开始导航")
      "EndGuide" -> words("Route guidance has ended", "导航已结束")
      "CheckingRouteChange" -> words("Checking the route", "正在检查路线")
      "RouteChanged" -> words("The route has been updated", "路线已更新")
      "RouteUnchanged" -> words("Continue on the current route", "请继续按照当前路线行驶")
      "OutOfRoute" -> words("You are off the route. Recalculating", "已偏离路线，正在重新规划")
      "GPSConnected" -> words("GPS signal restored", "GPS信号已恢复")
      "SchoolZone" -> words("School zone. Drive carefully", "前方学校区域，请谨慎驾驶")
      "Hipass" -> words("Electronic toll collection lane ahead", "前方电子收费车道")
      "BusLaneGuide" -> words("Watch for the bus lane restrictions", "请注意公交专用车道限制")
      "StrateToNext" -> words("Continue ahead along the route", "请沿路线继续前行")
      "DetailDir", "MultiRoute" -> words("Check the lane and direction shown on the map", "请注意地图所示车道和方向")
      // Nonverbal tones remain SDK audio; they carry no Korean speech.
      "Alram", "Alarm", "Alert", "LinkSound" -> null
      else -> null
    } ?: return null
    if (event != "KNVoiceCode_Turn") return "$action."
    return if (language == "zh") (if (atPosition) "现在，" else "前方，") + action + "。"
      else (if (atPosition) "Now, " else "Ahead, ") + action.replaceFirstChar { it.lowercase() } + "."
  }

  private fun maneuver(language: String, code: String): String {
    fun words(en: String, zh: String) = if (language == "zh") zh else en
    val clock = code.substringAfterLast('_').toIntOrNull()
    if (clock != null && clock in 1..12) {
      return if (code.startsWith("RoundaboutDirection_") || code.startsWith("RotaryDirection_"))
        words("At the roundabout, take the exit at $clock o'clock", "在环岛从${clock}点钟方向驶出")
      else words("Head in the $clock o'clock direction", "向${clock}点钟方向行驶")
    }
    return when (code) {
      "Start" -> words("Start along the route", "沿路线出发")
      "Goal" -> words("Arrive at your destination", "到达目的地")
      "Via" -> words("Reach the waypoint", "到达途经点")
      "Straight" -> words("Continue straight", "直行")
      "LeftTurn" -> words("Turn left", "左转")
      "UnprotectedLeftTurn" -> words("Turn left when safe. Yield to oncoming traffic", "确认安全后左转，请让对向车辆先行")
      "RightTurn" -> words("Turn right", "右转")
      "UTurn" -> words("Make a U-turn", "掉头")
      "LeftDirection", "LeftStraight" -> words("Keep left", "靠左行驶")
      "RightDirection", "RightStraight" -> words("Keep right", "靠右行驶")
      "OutHighway", "OutCityway" -> words("Take the exit", "驶出快速道路")
      "LeftOutHighway", "LeftOutCityway" -> words("Take the exit on the left", "从左侧出口驶出")
      "RightOutHighway", "RightOutCityway" -> words("Take the exit on the right", "从右侧出口驶出")
      "InHighway", "InCityway" -> words("Enter the expressway", "驶入快速道路")
      "LeftInHighway", "LeftInCityway" -> words("Enter the expressway on the left", "从左侧驶入快速道路")
      "RightInHighway", "RightInCityway" -> words("Enter the expressway on the right", "从右侧驶入快速道路")
      "ChangeLeftHighway" -> words("Take the connecting road on the left", "走左侧连接道路")
      "ChangeRightHighway" -> words("Take the connecting road on the right", "走右侧连接道路")
      "OverPath", "LeftOverPath", "RightOverPath" -> words("Take the overpass", "走高架道路")
      "UnderPath", "LeftUnderPath", "RightUnderPath" -> words("Take the underpass", "走地下通道")
      "Tunnel", "LeftTunnel", "RightTunnel" -> words("Enter the tunnel", "进入隧道")
      "OverPathSide", "UnderPathSide", "TunnelSide", "LeftOverPathSide", "RightOverPathSide", "LeftUnderPathSide", "RightUnderPathSide", "LeftTunnelSide", "RightTunnelSide" -> words("Take the road alongside, following the map", "按照地图沿旁侧道路行驶")
      "Tollgate", "NonstopTollgate" -> words("Approach the tollgate", "通过收费站")
      "JoinAfterBranch" -> words("Merge along the route", "沿路线汇入道路")
      "InFerry" -> words("Board the ferry", "驶入渡轮")
      "OutFerry" -> words("Leave the ferry", "驶离渡轮")
      "IndoorEnterance" -> words("Enter the parking facility", "进入停车场")
      "IndoorExit" -> words("Exit the parking facility", "驶出停车场")
      "IndoorToUpFloor" -> words("Go up to the next level", "前往上一层")
      "IndoorToDownFloor" -> words("Go down to the next level", "前往下一层")
      else -> words("Follow the route shown on the map", "请按照地图所示路线行驶")
    }
  }

  private fun hazard(language: String, code: String): String {
    fun words(en: String, zh: String) = if (language == "zh") zh else en
    return when {
      code.contains("Camera") -> words("Traffic enforcement camera ahead. Observe the posted restrictions", "前方交通执法摄像头，请遵守道路限速和交通规则")
      code.contains("Children") -> words("Children's safety zone ahead. Drive carefully", "前方儿童安全区域，请谨慎驾驶")
      code == "Hump" -> words("Speed bump ahead", "前方减速带")
      code.contains("SharpTurn") -> words("Sharp bend ahead", "前方急弯")
      code.contains("Frozen") || code.contains("Slipping") -> words("Slippery road ahead", "前方路面湿滑")
      code.contains("Fog") -> words("Fog ahead. Drive carefully", "前方有雾，请谨慎驾驶")
      code.contains("Railroad") -> words("Railroad crossing ahead", "前方铁路道口")
      code.contains("FallingRocks") -> words("Falling rocks area ahead", "前方落石区域")
      code.contains("RoadNarrows") -> words("Road narrows ahead", "前方道路变窄")
      code.contains("Downhill") -> words("Steep descent ahead", "前方陡坡下行")
      code.contains("Animals") -> words("Watch for animals crossing", "注意动物穿行")
      code.contains("Flood") -> words("Flood risk ahead", "前方有积水风险")
      code.contains("Accident") -> words("Accident-prone area ahead. Drive carefully", "前方事故多发区域，请谨慎驾驶")
      code.contains("HeightLimit") -> words("Height restriction ahead. Check the posted limit", "前方限高，请注意限高标志")
      code.contains("WeightLimit") -> words("Weight restriction ahead. Check the posted limit", "前方限重，请注意限重标志")
      else -> words("Road safety caution ahead. Check the navigation display", "前方道路安全提醒，请查看导航画面")
    }
  }
}

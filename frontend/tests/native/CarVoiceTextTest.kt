package com.tikkeuldata.navigation

fun main() {
  for (language in listOf("en", "zh")) {
    val left = CarVoiceText.text(language, "KNVoiceCode_Turn", "KNRGCode_LeftTurn")!!
    val right = CarVoiceText.text(language, "KNVoiceCode_Turn", "KNRGCode_RightTurn", atPosition = true)!!
    check(left.contains(if (language == "en") "left" else "左转"))
    check(right.contains(if (language == "en") "Now" else "现在"))
    check(right.contains(if (language == "en") "right" else "右转"))
    check(!Regex("[가-힣]").containsMatchIn(left + right))
    check(CarVoiceText.text(language, "KNVoiceCode_Unknown") == null)
    check(CarVoiceText.text(language, "KNVoiceCode_Alert") == null)
    val unknown = CarVoiceText.text(language, "KNVoiceCode_Turn", "KNRGCode_FutureManeuver")!!
    check(unknown.contains(if (language == "en") "map" else "地图"))
    val circle = CarVoiceText.text(language, "KNVoiceCode_Turn", "KNRGCode_RoundaboutDirection_3")!!
    check(circle.contains("3"))
    check(!circle.contains(if (language == "en") "third exit" else "第三"))
    for (event in listOf("StartGuide", "EndGuide", "OutOfRoute", "CheckingRouteChange", "RouteChanged", "RouteUnchanged", "GPSConnected", "SchoolZone", "BusLaneGuide")) {
      val text = CarVoiceText.text(language, "KNVoiceCode_$event")!!
      check(text.isNotBlank() && !Regex("[가-힣]").containsMatchIn(text))
    }
    val camera = CarVoiceText.text(language, "KNVoiceCode_Safety", safety = "KNSafetyCode_SpeedViolationCamera")!!
    check(camera.contains(if (language == "en") "camera" else "摄像头"))
    // No fabricated speed limits or distances from the SDK's categorical voice distance.
    check(!Regex("\\d").containsMatchIn(camera))
  }
  println("CarVoiceText: English/Chinese turns, timing, roundabout clock direction, reroute, safety and unknown events passed")
}

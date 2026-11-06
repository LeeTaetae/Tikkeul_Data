package com.tikkeuldata.vision

import org.json.JSONArray
import org.json.JSONObject

/** JS 계약 테스트와 같은 파일(`src/test/resources/vision-contract.json`)을 읽는다. */
internal object ContractFixture {
  val root: JSONObject by lazy {
    val stream = ContractFixture::class.java.classLoader!!.getResourceAsStream("vision-contract.json")
      ?: error("vision-contract.json not found on the test classpath")
    JSONObject(stream.bufferedReader(Charsets.UTF_8).readText())
  }

  fun strings(array: JSONArray): List<String> = List(array.length()) { array.getString(it) }
  fun floats(array: JSONArray): FloatArray = FloatArray(array.length()) { array.getDouble(it).toFloat() }
  fun ints(array: JSONArray): IntArray = IntArray(array.length()) { array.getInt(it) }

  val labels: List<String> get() = strings(root.getJSONObject("contract").getJSONArray("labels"))
}

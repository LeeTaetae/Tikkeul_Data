$ErrorActionPreference = 'Stop'
$frontendRoot = Split-Path $PSScriptRoot -Parent
$voiceCache = Join-Path $env:USERPROFILE '.gradle/caches/modules-2/files-2.1'
$compilerParts = @(
  @('org.jetbrains.kotlin', 'kotlin-compiler-embeddable', '2.2.10'),
  @('org.jetbrains.kotlin', 'kotlin-stdlib', '2.2.10'),
  @('org.jetbrains.kotlin', 'kotlin-daemon-embeddable', '2.2.10'),
  @('org.jetbrains.kotlin', 'kotlin-script-runtime', '2.2.10'),
  @('org.jetbrains.kotlin', 'kotlin-reflect', '1.6.10'),
  @('org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.8.0'),
  @('org.jetbrains', 'annotations', '13.0')
)
$voiceJars = @($compilerParts | ForEach-Object {
  Get-ChildItem (Join-Path $voiceCache ($_ -join '/')) -Recurse -Filter '*.jar' | Select-Object -First 1 -ExpandProperty FullName
})
$voiceCp = $voiceJars -join ';'
$javaRoot = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'C:/Program Files/Android/Android Studio/jbr' }
$voiceJava = Join-Path $javaRoot 'bin/java.exe'
$voiceOutput = Join-Path $frontendRoot 'artifacts/car-voice-tests'
New-Item -ItemType Directory -Force $voiceOutput | Out-Null
& $voiceJava -cp $voiceCp org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect -classpath $voiceCp -d $voiceOutput `
  (Join-Path $frontendRoot 'modules/kakao-navigation/android/src/main/java/com/tikkeuldata/navigation/CarVoiceText.kt') `
  (Join-Path $frontendRoot 'tests/native/CarVoiceTextTest.kt')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $voiceJava -cp ($voiceOutput + ';' + $voiceCp) com.tikkeuldata.navigation.CarVoiceTextTestKt
exit $LASTEXITCODE

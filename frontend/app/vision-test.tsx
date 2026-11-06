// Legacy debug URL: reuse the admin screen's role check and single focused camera panel.
import { Redirect } from 'expo-router';

export default function VisionTestScreen() {
  return <Redirect href="/admin" />;
}

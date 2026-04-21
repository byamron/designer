/* Smoke test for type narrowing. Not shipped. */
import { Box } from "./Box";
import { Stack } from "./Stack";
import { Overlay } from "./Overlay";

// ✅ valid token usage
<Box padding={3} radius="card" background="accent-9" border="gray-6" elevation="raised" />;
<Box background="gray-a4" />;
<Stack space={4} align="center" split={2} />;
<Overlay anchor="top-right" layer="modal" />;

// ✅ escape hatches on Color props
<Box background="var(--accent-3)" />;
<Box background="linear-gradient(var(--accent-9), var(--accent-11))" />;
<Box background="color-mix(in oklch, var(--accent-9) 40%, transparent)" />;

// ❌ the following should error — uncomment to verify locally
// <Box padding={9} />;                    // 9 not in SpaceToken
// <Box radius="rounded" />;               // "rounded" not in RadiusToken
// <Box elevation="floating" />;           // "floating" not in ElevationToken
// <Stack align="middle" />;               // "middle" not a valid align
// <Stack split={11} />;                   // 11 out of range
// <Overlay anchor="upper-left" />;        // "upper-left" not in Anchor
// <Overlay layer="floating" />;           // not in LayerToken

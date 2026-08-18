import 'package:flutter/widgets.dart';
import 'package:game_engine/game_engine.dart';

/// Corner controls only — frame timings come from Apple's Metal HUD.
class Toggles extends StatelessWidget {
  const Toggles({
    required this.settings,
    required this.status,
    required this.onScale,
    required this.onUpscaler,
    required this.onFrameGen,
    required this.onBounces,
    required this.onSamples,
    required this.onVolumetrics,
    required this.onSoftShadows,
    super.key,
  });

  final RenderSettings settings;
  final EngineStatus? status;
  final VoidCallback onScale;
  final VoidCallback onUpscaler;
  final VoidCallback onFrameGen;
  final VoidCallback onBounces;
  final VoidCallback onSamples;
  final VoidCallback onVolumetrics;
  final VoidCallback onSoftShadows;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: const Color(0xB8000000),
      borderRadius: BorderRadius.circular(7),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        mainAxisSize: MainAxisSize.min,
        children: [
          _Toggle(
            label: 'RT RESOLUTION',
            value: '${status?.renderWidth ?? settings.renderWidth}p',
            onTap: onScale,
          ),
          _Toggle(
            label: 'METALFX UPSCALER',
            value: settings.upscaler.name.toUpperCase(),
            onTap: onUpscaler,
          ),
          _Toggle(
            label: 'METALFX FRAME GEN',
            value: settings.frameInterpolation ? 'ON' : 'OFF',
            onTap: onFrameGen,
          ),
          _Toggle(
            label: 'SAMPLES / PIXEL',
            value: '${settings.samples}',
            onTap: onSamples,
          ),
          _Toggle(
            label: 'BOUNCES',
            value: '${settings.bounceRays}',
            onTap: onBounces,
          ),
          _Toggle(
            label: 'VOLUMETRICS',
            value: settings.volumetrics ? 'ON' : 'OFF',
            onTap: onVolumetrics,
          ),
          _Toggle(
            label: 'SOFT SHADOWS',
            value: settings.softShadows ? 'ON' : 'OFF',
            onTap: onSoftShadows,
          ),
        ],
      ),
    ),
  );
}

class _Toggle extends StatelessWidget {
  const _Toggle({
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => GestureDetector(
    onTap: onTap,
    behavior: HitTestBehavior.opaque,
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            label,
            style: const TextStyle(
              fontFamily: 'Menlo',
              fontSize: 10,
              color: Color(0x9973C991),
            ),
            textDirection: TextDirection.ltr,
          ),
          const SizedBox(width: 10),
          SizedBox(
            width: 86,
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: const TextStyle(
                fontFamily: 'Menlo',
                fontSize: 11,
                color: Color(0xFF66F5F5),
              ),
              textDirection: TextDirection.ltr,
            ),
          ),
        ],
      ),
    ),
  );
}

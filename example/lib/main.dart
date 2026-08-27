import 'package:flutter/widgets.dart';
import 'package:game_engine_palapa/game_engine_palapa.dart';
import 'package:palapa_game_engine/city_walk.dart';
import 'package:palapa_game_engine/toggles.dart';

void main() => runApp(const CityWalkApp());

class CityWalkApp extends StatelessWidget {
  const CityWalkApp({super.key});

  @override
  Widget build(BuildContext context) => WidgetsApp(
    color: const Color(0xFF000000),
    title: 'palapa-game-engine',
    debugShowCheckedModeBanner: false,
    builder: (context, _) => const _Game(),
  );
}

class _Game extends StatefulWidget {
  const _Game();

  @override
  State<_Game> createState() => _GameState();
}

class _GameState extends State<_Game> {
  final _walk = CityWalk();
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    _walk.addListener(_onFrame);
  }

  @override
  void dispose() {
    _walk.removeListener(_onFrame);
    _walk.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _onFrame() => setState(() {});

  @override
  Widget build(BuildContext context) => Focus(
    focusNode: _focus,
    autofocus: true,
    onKeyEvent: (_, event) => _walk.handleKey(event),
    child: Stack(
      fit: StackFit.expand,
      children: [
        // Click the world to take the mouse, escape or losing focus to get it
        // back — the contract every windowed game keeps.
        GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTapDown: (_) {
            _focus.requestFocus();
            _walk.setCaptured(true);
          },
          onPanDown: (_) => _focus.requestFocus(),
          onPanUpdate: (details) => _walk.look(details.delta),
          child: GameSurface(
            textureId: _walk.textureId,
            onResize: (size) =>
                _walk.resize(size, MediaQuery.devicePixelRatioOf(context)),
          ),
        ),
        Align(
          alignment: Alignment.topLeft,
          child: Padding(
            padding: const EdgeInsets.all(14),
            // The panel sits above the world detector and swallows its own
            // clicks, so tapping a setting never grabs the mouse.
            child: GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTapDown: (_) {},
              child: Toggles(
                settings: _walk.settings,
                status: _walk.status,
                fps: _walk.fps,
                generatedFps: _walk.generatedFps,
                rayMode: _walk.rayMode,
                totalRays: _walk.totalRays,
                onRays: _walk.cycleRayMode,
                onScale: _walk.cycleResolution,
                projection: _walk.projection,
                onProjection: _walk.cycleProjection,
                onUpscaled: _walk.cycleUpscaled,
                onUpscaler: _walk.cycleUpscaler,
                onFrameGen: (_) => _walk.toggleFrameGen(),
                onBounces: _walk.cycleBounces,
                onSamples: _walk.cycleSamples,
                targetRate: _walk.targetRate,
                onFrameRate: _walk.cycleFrameRate,
              ),
            ),
          ),
        ),
      ],
    ),
  );
}

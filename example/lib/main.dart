import 'package:flutter/widgets.dart';
import 'package:game_engine/game_engine.dart';
import 'package:palapa_game_engine/city_walk.dart';
import 'package:palapa_game_engine/toggles.dart';

void main() => runApp(const CityWalkApp());

class CityWalkApp extends StatelessWidget {
  const CityWalkApp({super.key});

  @override
  Widget build(BuildContext context) => WidgetsApp(
    color: const Color(0xFF000000),
    title: 'palapa-game-engine',
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
    child: GestureDetector(
      behavior: HitTestBehavior.opaque,
      onPanDown: (_) => _focus.requestFocus(),
      onPanUpdate: (details) => _walk.look(details.delta),
      child: Stack(
        fit: StackFit.expand,
        children: [
          GameSurface(
            textureId: _walk.textureId,
            onResize: (size) =>
                _walk.resize(size, MediaQuery.devicePixelRatioOf(context)),
          ),
          Align(
            alignment: Alignment.bottomRight,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Toggles(
                settings: _walk.settings,
                status: _walk.status,
                onScale: _walk.cycleResolution,
                onUpscaler: _walk.cycleUpscaler,
                onFrameGen: _walk.toggleFrameGen,
                onBounces: _walk.cycleBounces,
                onSamples: _walk.cycleSamples,
                onVolumetrics: _walk.toggleVolumetrics,
                onSoftShadows: _walk.toggleSoftShadows,
              ),
            ),
          ),
        ],
      ),
    ),
  );
}

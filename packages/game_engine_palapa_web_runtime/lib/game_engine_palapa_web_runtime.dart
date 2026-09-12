import 'dart:js_interop';
import 'package:web/web.dart' as web;

abstract final class WebRuntime {
  static Future<JSObject> load(String module) async {
    final uri = Uri.parse(web.document.baseURI).resolve(
      'assets/packages/game_engine_palapa_web_runtime/runtime/$module',
    );
    return await importModule(uri.toString().toJS).toDart;
  }
}

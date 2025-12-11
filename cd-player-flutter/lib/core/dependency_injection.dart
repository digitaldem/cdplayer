import 'package:flutter/foundation.dart';
import 'package:get_it/get_it.dart';
import 'package:logger/logger.dart';

import '../networking/web_socket_client.dart';
import '../presentation/providers/player_provider.dart';
import './constants.dart';

class DependencyInjection {
  static final getIt = GetIt.instance;
  static Future<void> init() async {
    // Logging
    getIt.registerSingleton<Logger>(Logger(printer: SimplePrinter(), filter: _CustomLogFilter()));

    // Networking
    getIt.registerLazySingleton<WebSocketClient>(() => WebSocketClient.build(Constants.WEB_SOCKET_URL));

    // Providers
    getIt.registerLazySingleton<PlayerProvider>(() => PlayerProvider(client: getIt()));
  }

  static T resolve<T extends Object>() => getIt<T>();
}

class _CustomLogFilter extends LogFilter {
  @override
  bool shouldLog(LogEvent event) {
    if (event.level == Level.info) {
      return true;
    }
    if (event.level == Level.debug) {
      return kDebugMode;
    }

    return event.level.index >= Level.warning.index;
  }
}

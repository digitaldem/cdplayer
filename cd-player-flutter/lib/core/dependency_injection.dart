import 'package:get_it/get_it.dart';
import 'package:logger/logger.dart';

import '../networking/web_socket_client.dart';
import '../presentation/providers/player_provider.dart';
import './constants.dart';
import './display_sleep_manager.dart';
import './simple_logger.dart';

class DependencyInjection {
  static final getIt = GetIt.instance;
  static Future<void> init() async {
    // Logging
    getIt.registerSingleton<Logger>(SimpleLogger());

    // Display Sleep
    getIt.registerSingleton<DisplaySleepManager>(DisplaySleepManager(timeout: const Duration(minutes: 2)));

    // Networking
    getIt.registerLazySingleton<WebSocketClient>(() => WebSocketClient.build(Constants.WEB_SOCKET_URL));

    // Providers
    getIt.registerLazySingleton<PlayerProvider>(() => PlayerProvider(client: getIt()));
  }

  static T resolve<T extends Object>() => getIt<T>();
}

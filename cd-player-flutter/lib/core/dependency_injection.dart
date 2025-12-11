import 'package:get_it/get_it.dart';

import '../networking/web_socket_client.dart';
import '../presentation/providers/player_provider.dart';
import './constants.dart';

class DependencyInjection {
  static final getIt = GetIt.instance;

  static Future<void> init() async {
    // Networking
    getIt.registerLazySingleton<WebSocketClient>(() => WebSocketClient.build(Constants.WEB_SOCKET_URL));

    // Providers
    getIt.registerLazySingleton<PlayerProvider>(() => PlayerProvider(client: getIt()));
  }
}

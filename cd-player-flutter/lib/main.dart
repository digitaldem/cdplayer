import 'package:flutter/material.dart';
import 'package:desktop_window/desktop_window.dart';
import 'package:provider/provider.dart';

import './core/constants.dart';
import './core/dependency_injection.dart';
import './presentation/providers/player_provider.dart';
import './presentation/themes/dark_theme.dart';
import './presentation/themes/light_theme.dart';
import './app.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await DesktopWindow.setWindowSize(Size(Constants.WINDOW_SIZE_WIDTH, Constants.WINDOW_SIZE_HEIGHT));
  //await DesktopWindow.setFullScreen(false);

  await DependencyInjection.init();
  runApp(
    MultiProvider(
      providers: [ChangeNotifierProvider(create: (_) => DependencyInjection.getIt<PlayerProvider>())],
      child: MaterialApp(debugShowCheckedModeBanner: false, theme: LightTheme.theme, darkTheme: DarkTheme.theme, home: const App()),
    ),
  );
}

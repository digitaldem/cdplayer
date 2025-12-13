import 'dart:io';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:window_manager/window_manager.dart';

import './core/constants.dart';
import './core/dependency_injection.dart';
import './presentation/providers/player_provider.dart';
import './presentation/themes/dark_theme.dart';
import './presentation/themes/light_theme.dart';
import './app.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await windowManager.ensureInitialized();
  await windowManager.setSize(Size(Constants.WINDOW_SIZE_WIDTH, Constants.WINDOW_SIZE_HEIGHT));
  if (Platform.isLinux) {
    await windowManager.setFullScreen(true);
  }

  await DependencyInjection.init();

  runApp(
    MultiProvider(
      providers: [ChangeNotifierProvider(create: (_) => DependencyInjection.getIt<PlayerProvider>())],
      child: MaterialApp(
        debugShowCheckedModeBanner: false, 
        theme: LightTheme.theme, 
        darkTheme: DarkTheme.theme, 
        themeMode: ThemeMode.system,
        home: const App(),
      ),
    ),
  );
}

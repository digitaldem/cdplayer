import 'package:flutter/material.dart';

class DarkTheme {
  static ThemeData get theme {
    final background = Color.fromARGB(255, 13, 13, 13);
    final primary = Color.fromARGB(255, 216, 216, 216);
    final secondary = Color.fromARGB(255, 246, 220, 133);
    final surface = Color.fromARGB(255, 24, 24, 24);

    return ThemeData.dark().copyWith(
      appBarTheme: AppBarTheme(elevation: 0, scrolledUnderElevation: 0, surfaceTintColor: Colors.transparent),
      scaffoldBackgroundColor: background,
      colorScheme: ColorScheme.dark().copyWith(primary: primary, surface: surface, secondary: secondary),
      textTheme: TextTheme(
        bodyLarge: TextStyle(color: primary, fontSize: 40),
        bodyMedium: TextStyle(color: primary, fontSize: 30),
        bodySmall: TextStyle(color: primary, fontSize: 24),
      ),
      iconTheme: IconThemeData(color: secondary, size: 24.0),
    );
  }
}

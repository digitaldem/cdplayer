import 'package:flutter/material.dart';

class LightTheme {
  static ThemeData get theme {
    final background = Color.fromARGB(255, 216, 216, 216);
    final primary = Color.fromARGB(255, 13, 13, 13);
    final secondary = Color.fromARGB(255, 100, 141, 207);
    final surface = Color.fromARGB(255, 205, 205, 205);

    return ThemeData.light().copyWith(
      appBarTheme: AppBarTheme(elevation: 0, scrolledUnderElevation: 0, surfaceTintColor: Colors.transparent),
      scaffoldBackgroundColor: background,
      colorScheme: ColorScheme.light().copyWith(primary: primary, surface: surface, secondary: secondary),
      textTheme: TextTheme(
        bodyLarge: TextStyle(color: primary, fontSize: 40),
        bodyMedium: TextStyle(color: primary, fontSize: 30),
        bodySmall: TextStyle(color: primary, fontSize: 24),
      ),
      iconTheme: IconThemeData(color: secondary, size: 24.0),
    );
  }
}

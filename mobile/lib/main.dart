import 'package:flutter/material.dart';

import 'api.dart';
import 'home_page.dart';
import 'login_page.dart';

// Nord-ish palette to match the Zenify web player.
const kBg = Color(0xFF2E3440);
const kSurface = Color(0xFF3B4252);
const kSurfaceHi = Color(0xFF434C5E);
const kAccent = Color(0xFF88C0D0);
const kText = Color(0xFFECEFF4);
const kTextDim = Color(0xFFAEB6C3);

void main() {
  runApp(const ZenifyRemoteApp());
}

class ZenifyRemoteApp extends StatelessWidget {
  const ZenifyRemoteApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Zenify Remote',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        scaffoldBackgroundColor: kBg,
        colorScheme: const ColorScheme.dark(
          primary: kAccent,
          secondary: kAccent,
          surface: kSurface,
          onPrimary: kBg,
          onSurface: kText,
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: kBg,
          foregroundColor: kText,
          elevation: 0,
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: kSurface,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide.none,
          ),
          hintStyle: const TextStyle(color: kTextDim),
          labelStyle: const TextStyle(color: kTextDim),
        ),
        snackBarTheme: const SnackBarThemeData(
          backgroundColor: kSurfaceHi,
          contentTextStyle: TextStyle(color: kText),
          behavior: SnackBarBehavior.floating,
        ),
      ),
      home: const _Gate(),
    );
  }
}

/// Decides between login and the remote screen based on the saved session.
class _Gate extends StatefulWidget {
  const _Gate();

  @override
  State<_Gate> createState() => _GateState();
}

class _GateState extends State<_Gate> {
  late final Future<ZenifyApi> _restore = ZenifyApi.restore();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<ZenifyApi>(
      future: _restore,
      builder: (context, snap) {
        final api = snap.data;
        if (api == null) {
          return const Scaffold(
            body: Center(child: CircularProgressIndicator(color: kAccent)),
          );
        }
        return api.loggedIn ? HomePage(api: api) : LoginPage(api: api);
      },
    );
  }
}

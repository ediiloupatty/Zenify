import 'package:flutter/material.dart';

import 'api.dart';
import 'home_page.dart';
import 'main.dart';

class LoginPage extends StatefulWidget {
  final ZenifyApi api;
  const LoginPage({super.key, required this.api});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final TextEditingController _username = TextEditingController();
  final TextEditingController _password = TextEditingController();
  bool _busy = false;
  bool _hidePassword = true;
  String? _error;

  @override
  void dispose() {
    _username.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final username = _username.text.trim();
    final password = _password.text;
    if (username.isEmpty || password.isEmpty) {
      setState(() => _error = 'Isi username dan password dulu ya.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.api.login(username, password);
      if (!mounted) return;
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => HomePage(api: widget.api)),
      );
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (_) {
      setState(() => _error = 'Login gagal, coba lagi.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 28),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Icon(Icons.graphic_eq_rounded, size: 64, color: kAccent),
                const SizedBox(height: 12),
                const Text(
                  'Zenify Remote',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 26,
                    fontWeight: FontWeight.w700,
                    color: kText,
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Kontrol musik di laptop dari HP',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: kTextDim),
                ),
                const SizedBox(height: 32),
                TextField(
                  controller: _username,
                  autocorrect: false,
                  decoration: const InputDecoration(
                    labelText: 'Username atau email',
                    prefixIcon: Icon(Icons.person_rounded, color: kTextDim),
                  ),
                ),
                const SizedBox(height: 14),
                TextField(
                  controller: _password,
                  obscureText: _hidePassword,
                  onSubmitted: (_) => _busy ? null : _submit(),
                  decoration: InputDecoration(
                    labelText: 'Password',
                    prefixIcon: const Icon(Icons.lock_rounded, color: kTextDim),
                    suffixIcon: IconButton(
                      icon: Icon(
                        _hidePassword
                            ? Icons.visibility_rounded
                            : Icons.visibility_off_rounded,
                        color: kTextDim,
                      ),
                      onPressed: () =>
                          setState(() => _hidePassword = !_hidePassword),
                    ),
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Text(
                    _error!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Color(0xFFBF616A)),
                  ),
                ],
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: _busy ? null : _submit,
                  style: FilledButton.styleFrom(
                    backgroundColor: kAccent,
                    foregroundColor: kBg,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: _busy
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.5,
                            color: kBg,
                          ),
                        )
                      : const Text(
                          'Masuk',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                ),
                const SizedBox(height: 16),
                const Text(
                  'Masuk pakai akun Zenify kamu — sama seperti di web.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: kTextDim, fontSize: 12),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

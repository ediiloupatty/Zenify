import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

const _kToken = 'zenify_token';
const _kName = 'zenify_name';

/// The Zenify server this app talks to. Baked in so users only ever log in
/// with their account — override for local dev with:
///   flutter run --dart-define=ZENIFY_SERVER=http://192.168.1.10:3000
const kServer = String.fromEnvironment(
  'ZENIFY_SERVER',
  defaultValue: 'https://www.zenify.cc',
);

const _timeout = Duration(seconds: 8);

class ApiException implements Exception {
  final String message;
  ApiException(this.message);
  @override
  String toString() => message;
}

class RemoteState {
  final bool online;
  final String? trackId;
  final String title;
  final String artist;
  final String album;
  final String cover;
  final bool isPlaying;

  RemoteState({
    required this.online,
    this.trackId,
    this.title = '',
    this.artist = '',
    this.album = '',
    this.cover = '',
    this.isPlaying = false,
  });

  factory RemoteState.fromJson(Map<String, dynamic> json) {
    final s = json['state'];
    if (s is! Map<String, dynamic>) {
      return RemoteState(online: json['online'] == true);
    }
    return RemoteState(
      online: json['online'] == true,
      trackId: s['trackId'] as String?,
      title: (s['title'] ?? '') as String,
      artist: (s['artist'] ?? '') as String,
      album: (s['album'] ?? '') as String,
      cover: (s['cover'] ?? '') as String,
      isPlaying: s['isPlaying'] == true,
    );
  }
}

class SearchResult {
  final String id;
  final String title;
  final String artist;
  final String album;
  final String cover;

  SearchResult({
    required this.id,
    required this.title,
    required this.artist,
    required this.album,
    required this.cover,
  });

  factory SearchResult.fromJson(Map<String, dynamic> json) => SearchResult(
        id: (json['id'] ?? '') as String,
        title: (json['title'] ?? '') as String,
        artist: (json['artist'] ?? '') as String,
        album: (json['album'] ?? '') as String,
        cover: (json['cover'] ?? '') as String,
      );
}

class ZenifyApi {
  final String baseUrl;
  String? token;
  String name;

  ZenifyApi({this.baseUrl = kServer, this.token, this.name = ''});

  bool get loggedIn => token != null;

  static Future<ZenifyApi> restore() async {
    final prefs = await SharedPreferences.getInstance();
    return ZenifyApi(
      token: prefs.getString(_kToken),
      name: prefs.getString(_kName) ?? '',
    );
  }

  Future<void> _persist() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kName, name);
    final t = token;
    if (t == null) {
      await prefs.remove(_kToken);
    } else {
      await prefs.setString(_kToken, t);
    }
  }

  Future<void> logout() async {
    token = null;
    await _persist();
  }

  Map<String, String> get _authHeaders => {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      };

  /// Turns a possibly-relative cover URL (e.g. /api/cover/x.jpg) into an
  /// absolute one on the Zenify server.
  String resolveUrl(String url) {
    if (url.isEmpty || url.startsWith('http')) return url;
    return '$baseUrl${url.startsWith('/') ? '' : '/'}$url';
  }

  Future<void> login(String username, String password) async {
    late http.Response res;
    try {
      res = await http
          .post(
            Uri.parse('$baseUrl/api/remote/login'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'username': username, 'password': password}),
          )
          .timeout(_timeout);
    } on TimeoutException {
      throw ApiException('Server tidak merespons. Coba lagi sebentar lagi.');
    } catch (_) {
      throw ApiException('Tidak bisa terhubung. Cek koneksi internet HP kamu.');
    }
    final body = _decode(res);
    token = body['token'] as String?;
    name = (body['name'] ?? '') as String;
    if (token == null) throw ApiException('Login gagal: server tidak mengirim token.');
    await _persist();
  }

  Future<RemoteState> fetchState() async {
    final res = await http
        .get(Uri.parse('$baseUrl/api/remote/state'), headers: _authHeaders)
        .timeout(_timeout);
    return RemoteState.fromJson(_decode(res));
  }

  Future<void> send(String action, {String? trackId}) async {
    final res = await http
        .post(
          Uri.parse('$baseUrl/api/remote/command'),
          headers: _authHeaders,
          body: jsonEncode({
            'action': action,
            'trackId': ?trackId,
          }),
        )
        .timeout(_timeout);
    _decode(res);
  }

  Future<List<SearchResult>> search(String query) async {
    final res = await http
        .get(
          Uri.parse('$baseUrl/api/remote/search')
              .replace(queryParameters: {'q': query}),
          headers: _authHeaders,
        )
        .timeout(_timeout);
    final body = _decode(res);
    final list = body['results'];
    if (list is! List) return [];
    return list
        .whereType<Map<String, dynamic>>()
        .map(SearchResult.fromJson)
        .toList();
  }

  Map<String, dynamic> _decode(http.Response res) {
    Map<String, dynamic> body;
    try {
      body = jsonDecode(res.body) as Map<String, dynamic>;
    } catch (_) {
      throw ApiException('Respons server tidak dikenali (HTTP ${res.statusCode}).');
    }
    if (res.statusCode == 401) {
      throw ApiException((body['error'] ?? 'Sesi berakhir, silakan login ulang.') as String);
    }
    if (res.statusCode >= 400) {
      throw ApiException((body['error'] ?? 'Terjadi kesalahan (HTTP ${res.statusCode}).') as String);
    }
    return body;
  }
}

import 'dart:async';

import 'package:flutter/material.dart';

import 'api.dart';
import 'login_page.dart';
import 'main.dart';
import 'search_page.dart';

class HomePage extends StatefulWidget {
  final ZenifyApi api;
  const HomePage({super.key, required this.api});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  RemoteState? _state;
  Timer? _timer;
  bool _fetching = false;

  @override
  void initState() {
    super.initState();
    _refresh();
    _timer = Timer.periodic(const Duration(seconds: 2), (_) => _refresh());
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    if (_fetching) return;
    _fetching = true;
    try {
      final s = await widget.api.fetchState();
      if (mounted) setState(() => _state = s);
    } on ApiException catch (e) {
      // Token rejected → back to login. Anything else keeps the last state.
      if (e.message.contains('login') || e.message.contains('Sesi')) {
        await _logout();
      }
    } catch (_) {
      if (mounted && _state != null) {
        setState(() => _state = RemoteState(online: false));
      }
    } finally {
      _fetching = false;
    }
  }

  Future<void> _send(String action) async {
    // Optimistic play/pause flip so the button feels instant.
    final s = _state;
    if (s != null && (action == 'play' || action == 'pause')) {
      setState(() => _state = RemoteState(
            online: s.online,
            trackId: s.trackId,
            title: s.title,
            artist: s.artist,
            album: s.album,
            cover: s.cover,
            isPlaying: action == 'play',
          ));
    }
    try {
      await widget.api.send(action);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Perintah gagal terkirim — cek koneksi.')),
        );
      }
    }
  }

  Future<void> _logout() async {
    await widget.api.logout();
    if (!mounted) return;
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => LoginPage(api: widget.api)),
    );
  }

  void _openSearch() {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => SearchPage(api: widget.api)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final s = _state;
    final online = s?.online ?? false;
    final hasTrack = online && (s?.title.isNotEmpty ?? false);
    final playing = s?.isPlaying ?? false;
    final cover = s == null ? '' : widget.api.resolveUrl(s.cover);

    return Scaffold(
      appBar: AppBar(
        title: Text(
          widget.api.name.isEmpty ? 'Zenify Remote' : 'Hai, ${widget.api.name}',
          style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
        ),
        actions: [
          IconButton(
            tooltip: 'Keluar',
            icon: const Icon(Icons.logout_rounded, color: kTextDim),
            onPressed: _logout,
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 24),
          child: Column(
            children: [
              _StatusChip(online: online),
              const Spacer(),
              // Cover art
              Container(
                width: 260,
                height: 260,
                decoration: BoxDecoration(
                  color: kSurface,
                  borderRadius: BorderRadius.circular(20),
                  boxShadow: const [
                    BoxShadow(
                      color: Colors.black38,
                      blurRadius: 30,
                      offset: Offset(0, 12),
                    ),
                  ],
                ),
                clipBehavior: Clip.antiAlias,
                child: cover.isNotEmpty
                    ? Image.network(
                        cover,
                        fit: BoxFit.cover,
                        errorBuilder: (_, _, _) => const _CoverPlaceholder(),
                      )
                    : const _CoverPlaceholder(),
              ),
              const SizedBox(height: 28),
              Text(
                hasTrack ? s!.title : (online ? 'Tidak ada lagu' : 'Laptop offline'),
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: kText,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                hasTrack
                    ? s!.artist
                    : (online
                        ? 'Putar sesuatu dari pencarian di bawah'
                        : 'Buka Zenify di browser laptop dulu'),
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 14, color: kTextDim),
              ),
              const Spacer(),
              // Transport controls
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  IconButton(
                    iconSize: 44,
                    color: kText,
                    icon: const Icon(Icons.skip_previous_rounded),
                    onPressed: online ? () => _send('prev') : null,
                  ),
                  const SizedBox(width: 20),
                  SizedBox(
                    width: 84,
                    height: 84,
                    child: FilledButton(
                      onPressed:
                          online ? () => _send(playing ? 'pause' : 'play') : null,
                      style: FilledButton.styleFrom(
                        backgroundColor: kAccent,
                        foregroundColor: kBg,
                        disabledBackgroundColor: kSurface,
                        shape: const CircleBorder(),
                        padding: EdgeInsets.zero,
                      ),
                      child: Icon(
                        playing ? Icons.pause_rounded : Icons.play_arrow_rounded,
                        size: 44,
                      ),
                    ),
                  ),
                  const SizedBox(width: 20),
                  IconButton(
                    iconSize: 44,
                    color: kText,
                    icon: const Icon(Icons.skip_next_rounded),
                    onPressed: online ? () => _send('next') : null,
                  ),
                ],
              ),
              const SizedBox(height: 28),
              // Search entry
              GestureDetector(
                onTap: _openSearch,
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 18, vertical: 14),
                  decoration: BoxDecoration(
                    color: kSurface,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.search_rounded, color: kTextDim),
                      SizedBox(width: 10),
                      Text('Cari lagu…', style: TextStyle(color: kTextDim)),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  final bool online;
  const _StatusChip({required this.online});

  @override
  Widget build(BuildContext context) {
    final color = online ? const Color(0xFFA3BE8C) : const Color(0xFFBF616A);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: kSurface,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 8),
          Text(
            online ? 'Terhubung ke laptop' : 'Laptop tidak terdeteksi',
            style: const TextStyle(fontSize: 12, color: kTextDim),
          ),
        ],
      ),
    );
  }
}

class _CoverPlaceholder extends StatelessWidget {
  const _CoverPlaceholder();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Icon(Icons.music_note_rounded, size: 72, color: kTextDim),
    );
  }
}

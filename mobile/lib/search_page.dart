import 'dart:async';

import 'package:flutter/material.dart';

import 'api.dart';
import 'main.dart';

class SearchPage extends StatefulWidget {
  final ZenifyApi api;
  const SearchPage({super.key, required this.api});

  @override
  State<SearchPage> createState() => _SearchPageState();
}

class _SearchPageState extends State<SearchPage> {
  final TextEditingController _query = TextEditingController();
  Timer? _debounce;
  List<SearchResult> _results = [];
  bool _loading = false;
  bool _searched = false;

  @override
  void dispose() {
    _debounce?.cancel();
    _query.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () => _search(value));
  }

  Future<void> _search(String value) async {
    final q = value.trim();
    if (q.isEmpty) {
      setState(() {
        _results = [];
        _searched = false;
      });
      return;
    }
    setState(() => _loading = true);
    try {
      final results = await widget.api.search(q);
      if (!mounted) return;
      setState(() {
        _results = results;
        _searched = true;
      });
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pencarian gagal — cek koneksi.')),
      );
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _play(SearchResult track) async {
    try {
      await widget.api.send('playTrack', trackId: track.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Memutar "${track.title}" di laptop 🎵')),
      );
      Navigator.of(context).pop();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Gagal memutar lagu — cek koneksi.')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: TextField(
          controller: _query,
          autofocus: true,
          onChanged: _onChanged,
          onSubmitted: _search,
          textInputAction: TextInputAction.search,
          style: const TextStyle(color: kText),
          decoration: const InputDecoration(
            hintText: 'Judul lagu atau artis…',
            prefixIcon: Icon(Icons.search_rounded, color: kTextDim),
            contentPadding: EdgeInsets.symmetric(vertical: 12),
          ),
        ),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: kAccent))
          : !_searched
              ? const Center(
                  child: Text(
                    'Ketik untuk mencari lagu di library Zenify',
                    style: TextStyle(color: kTextDim),
                  ),
                )
              : _results.isEmpty
                  ? const Center(
                      child: Text(
                        'Tidak ada lagu yang cocok',
                        style: TextStyle(color: kTextDim),
                      ),
                    )
                  : ListView.builder(
                      itemCount: _results.length,
                      itemBuilder: (context, i) {
                        final t = _results[i];
                        final cover = widget.api.resolveUrl(t.cover);
                        return ListTile(
                          onTap: () => _play(t),
                          leading: ClipRRect(
                            borderRadius: BorderRadius.circular(8),
                            child: SizedBox(
                              width: 48,
                              height: 48,
                              child: cover.isNotEmpty
                                  ? Image.network(
                                      cover,
                                      fit: BoxFit.cover,
                                      errorBuilder: (_, _, _) =>
                                          const _TileFallback(),
                                    )
                                  : const _TileFallback(),
                            ),
                          ),
                          title: Text(
                            t.title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: kText,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          subtitle: Text(
                            [t.artist, t.album]
                                .where((s) => s.isNotEmpty)
                                .join(' — '),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(color: kTextDim),
                          ),
                          trailing: const Icon(
                            Icons.play_circle_outline_rounded,
                            color: kAccent,
                          ),
                        );
                      },
                    ),
    );
  }
}

class _TileFallback extends StatelessWidget {
  const _TileFallback();

  @override
  Widget build(BuildContext context) {
    return Container(
      color: kSurface,
      child: const Icon(Icons.music_note_rounded, color: kTextDim, size: 24),
    );
  }
}

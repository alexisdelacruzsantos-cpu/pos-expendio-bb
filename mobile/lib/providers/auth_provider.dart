import 'package:flutter/foundation.dart';
import '../models/models.dart';
import '../services/api_service.dart';

class AuthProvider extends ChangeNotifier {
  final ApiService _apiService = ApiService();

  User? _user;
  bool _loading = false;
  String? _error;

  User? get user => _user;
  bool get isAuthenticated => _user != null;
  bool get loading => _loading;
  String? get error => _error;

  Future<void> init() async {
    final hasToken = await _apiService.init();
    if (hasToken) {
      final ok = await _apiService.validateToken(_apiService.token);
      if (ok) {
        _user = User(id: 0, username: 'usuario', fullName: '', role: '');
        notifyListeners();
      }
    }
  }

  Future<bool> login(String username, String password) async {
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      final user = await _apiService.login(username, password);
      if (user != null) {
        _user = user;
        _loading = false;
        notifyListeners();
        return true;
      }
      _error = 'Credenciales inválidas';
      return false;
    } on ApiException catch (e) {
      _error = 'Error de conexión con el servidor: ${e.message}';
      return false;
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  Future<void> logout() async {
    await _apiService.logout();
    _user = null;
    notifyListeners();
  }
}
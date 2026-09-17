import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../models/models.dart';

class ApiException implements Exception {
  final String message;
  final int? statusCode;
  ApiException(this.message, [this.statusCode]);

  @override
  String toString() => message;
}

class ApiService {
  static const String baseUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'http://localhost:5000/api',
  );
  String? _token;

  String get token => _token ?? '';

  Future<bool> init() async {
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString('auth_token');
    return _token != null;
  }

  Map<String, String> _headers({bool json = false}) => {
        if (json) 'Content-Type': 'application/json',
        'Authorization': 'Bearer $_token',
      };

  Future<bool> validateToken(String token) async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/auth/validate'),
        headers: {'Authorization': 'Bearer $token'},
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        _token = token;
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('auth_token', token);
        return data['valid'] == true;
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  Future<User?> login(String username, String password) async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/auth/login'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({'username': username, 'password': password}),
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        _token = data['token'] as String;
        final prefs = await SharedPreferences.getInstance();
        await prefs.setString('auth_token', _token!);
        return User.fromJson(data['user']);
      }
      if (response.statusCode == 401) {
        return null;
      }
      throw ApiException(
        jsonDecode(response.body)['error'] ?? 'Error al iniciar sesión',
        response.statusCode,
      );
    } on ApiException {
      rethrow;
    } catch (_) {
      throw ApiException('No se pudo conectar al servidor');
    }
  }

  Future<void> logout() async {
    _token = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('auth_token');
  }

  Future<SalesReport> getSalesReport({String? dateFrom, String? dateTo, int limit = 10}) async {
    final query = <String, String>{
      if (dateFrom != null && dateFrom.isNotEmpty) 'date_from': dateFrom,
      if (dateTo != null && dateTo.isNotEmpty) 'date_to': dateTo,
      'limit': '$limit',
    };
    final response = await http.get(
      Uri.parse('$baseUrl/reports/sales?${Uri(queryParameters: query).query}'),
      headers: _headers(),
    );
    final body = jsonDecode(response.body);
    if (response.statusCode != 200) {
      throw ApiException(body['error'] ?? 'Error al obtener reporte de ventas', response.statusCode);
    }
    return SalesReport.fromJson(body);
  }

  Future<List<Product>> getProducts({String search = ''}) async {
    final query = search.isNotEmpty
        ? '?search=${Uri.encodeComponent(search)}'
        : '';
    final response = await http.get(
      Uri.parse('$baseUrl/products/$query'),
      headers: _headers(),
    );
    final body = jsonDecode(response.body);
    if (response.statusCode != 200) {
      throw ApiException(body['error'] ?? 'Error al obtener productos', response.statusCode);
    }
    return (body as List).map((e) => Product.fromJson(e)).toList();
  }
}
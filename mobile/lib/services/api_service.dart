import 'dart:convert';
import 'package:flutter/foundation.dart' show kIsWeb;
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
  static const String _defaultBaseUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'http://localhost:5000/api',
  );
  static String baseUrl = _defaultBaseUrl;
  static String? _token;

  String get token => _token ?? '';

  static String _deriveBaseUrl() {
    if (kIsWeb) {
      final host = Uri.base.host;
      if (host.isNotEmpty && host != 'localhost' && host != '127.0.0.1') {
        return 'http://$host:5000/api';
      }
    }
    return _defaultBaseUrl;
  }

  Future<bool> init() async {
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString('auth_token');
    final savedUrl = prefs.getString('api_url');
    if (savedUrl != null && savedUrl.trim().isNotEmpty) {
      baseUrl = savedUrl.trim();
    } else {
      baseUrl = _deriveBaseUrl();
    }
    return _token != null;
  }

  static Future<void> setBaseUrl(String url) async {
    final trimmed = url.trim();
    baseUrl = trimmed.isEmpty ? _defaultBaseUrl : trimmed;
    final prefs = await SharedPreferences.getInstance();
    if (trimmed.isEmpty) {
      await prefs.remove('api_url');
    } else {
      await prefs.setString('api_url', trimmed);
    }
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

  Future<List<Sale>> getSalesHistory({
    String? dateFrom,
    String? dateTo,
    String? q,
    String? status,
    int limit = 100,
  }) async {
    final query = <String, String>{
      if (dateFrom != null && dateFrom.isNotEmpty) 'date_from': dateFrom,
      if (dateTo != null && dateTo.isNotEmpty) 'date_to': dateTo,
      if (q != null && q.trim().isNotEmpty) 'q': q.trim(),
      if (status != null && status.isNotEmpty) 'status': status,
      'limit': '$limit',
    };
    final response = await http.get(
      Uri.parse('$baseUrl/sales/?${Uri(queryParameters: query).query}'),
      headers: _headers(),
    );
    final body = jsonDecode(response.body);
    if (response.statusCode != 200) {
      throw ApiException(body['error'] ?? 'Error al obtener el historial', response.statusCode);
    }
    return (body as List).map((e) => Sale.fromJson(e)).toList();
  }

  Future<SaleDetail> getSaleDetail(int saleId) async {
    final response = await http.get(
      Uri.parse('$baseUrl/sales/$saleId'),
      headers: _headers(),
    );
    final body = jsonDecode(response.body);
    if (response.statusCode != 200) {
      throw ApiException(body['error'] ?? 'Error al obtener la venta', response.statusCode);
    }
    return SaleDetail.fromJson(body);
  }

  Future<AdjustmentProduct> getAdjustmentProduct(int productId) async {
    final response = await http.get(
      Uri.parse('$baseUrl/adjustments/product/$productId'),
      headers: _headers(),
    );
    final body = jsonDecode(response.body);
    if (response.statusCode != 200) {
      throw ApiException(body['error'] ?? 'Error al obtener el producto', response.statusCode);
    }
    return AdjustmentProduct.fromJson(body);
  }

  Future<void> applyAdjustment({
    required int productId,
    int? lotId,
    double? newQuantity,
    double? newPrice,
    double? newCost,
    double? newLotPrice,
    String? reason,
  }) async {
    final payload = <String, dynamic>{
      'product_id': productId,
      if (lotId != null) 'lot_id': lotId,
      if (newQuantity != null) 'new_quantity': newQuantity,
      if (newPrice != null) 'new_price': newPrice,
      if (newCost != null) 'new_cost': newCost,
      if (newLotPrice != null) 'new_lot_price': newLotPrice,
      if (reason != null && reason.isNotEmpty) 'reason': reason,
    };
    final response = await http.post(
      Uri.parse('$baseUrl/adjustments/'),
      headers: _headers(json: true),
      body: jsonEncode(payload),
    );
    final body = jsonDecode(response.body);
    if (response.statusCode != 200) {
      throw ApiException(body['error'] ?? 'Error al guardar el ajuste', response.statusCode);
    }
  }
}
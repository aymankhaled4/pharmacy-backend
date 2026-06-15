# MedConnect — Flutter Mobile App Architecture

## Project Overview

MedConnect is an Egyptian pharmacy platform. This document covers the **User Mobile App** (Flutter) only.

**Users can:**

- Search for drugs by name, generic name, or symptom description (AI-powered)
- Find nearby pharmacies that have the drug in stock
- Reserve drugs and get a short code for pickup
- Chat with an AI pharmacist assistant

---

## Tech Stack

| Layer            | Choice                      | Why                              |
| ---------------- | --------------------------- | -------------------------------- |
| Framework        | Flutter                     | Cross-platform                   |
| State Management | Cubit (flutter_bloc)        | Simple, predictable, testable    |
| HTTP             | Dio + Retrofit              | Type-safe API calls              |
| Auth             | Supabase Auth               | Email/Password — matches backend |
| Local Storage    | SharedPreferences           | Tokens, simple prefs             |
| Navigation       | GoRouter                    | Declarative, deep links          |
| Notifications    | Firebase Messaging (FCM)    | Already in backend               |
| Location         | geolocator                  | GPS coordinates                  |
| Maps             | flutter_map + OpenStreetMap | Free, no API key needed          |

---

## Folder Structure

```
lib/
├── main.dart
├── app.dart                        # MaterialApp + GoRouter setup
│
├── core/
│   ├── constants/
│   │   ├── api_constants.dart      # Base URL, endpoints
│   │   └── app_constants.dart      # App-wide constants
│   ├── errors/
│   │   └── failures.dart           # ServerFailure, NetworkFailure
│   ├── network/
│   │   ├── dio_client.dart         # Dio setup + interceptors
│   │   └── api_response.dart       # Generic { data, meta } wrapper
│   ├── storage/
│   │   └── local_storage.dart      # Token read/write
│   └── utils/
│       └── location_service.dart   # GPS helper
│
├── features/
│   ├── auth/
│   │   ├── data/
│   │   │   ├── models/user_model.dart
│   │   │   └── auth_repository.dart
│   │   ├── cubit/
│   │   │   ├── auth_cubit.dart
│   │   │   └── auth_state.dart
│   │   └── ui/
│   │       ├── login_screen.dart
│   │       └── register_screen.dart
│   │
│   ├── search/
│   │   ├── data/
│   │   │   ├── models/
│   │   │   │   ├── drug_model.dart
│   │   │   │   └── pharmacy_result_model.dart
│   │   │   └── search_repository.dart
│   │   ├── cubit/
│   │   │   ├── search_cubit.dart
│   │   │   └── search_state.dart
│   │   └── ui/
│   │       ├── search_screen.dart
│   │       ├── drug_results_screen.dart
│   │       └── widgets/
│   │           ├── pharmacy_card.dart
│   │           └── drug_card.dart
│   │
│   ├── reservation/
│   │   ├── data/
│   │   │   ├── models/reservation_model.dart
│   │   │   └── reservation_repository.dart
│   │   ├── cubit/
│   │   │   ├── reservation_cubit.dart
│   │   │   └── reservation_state.dart
│   │   └── ui/
│   │       ├── reservation_screen.dart
│   │       └── confirmation_screen.dart
│   │
│   ├── chat/
│   │   ├── data/
│   │   │   ├── models/
│   │   │   │   ├── chat_message_model.dart
│   │   │   │   └── chat_response_model.dart
│   │   │   └── chat_repository.dart
│   │   ├── cubit/
│   │   │   ├── chat_cubit.dart
│   │   │   └── chat_state.dart
│   │   └── ui/
│   │       ├── chat_screen.dart
│   │       └── widgets/
│   │           ├── message_bubble.dart
│   │           └── chat_input.dart
│   │
│   └── notifications/
│       ├── data/
│       │   ├── models/notification_model.dart
│       │   └── notifications_repository.dart
│       ├── cubit/
│       │   ├── notifications_cubit.dart
│       │   └── notifications_state.dart
│       └── ui/
│           └── notifications_screen.dart
│
└── shared/
    ├── widgets/
    │   ├── loading_widget.dart
    │   ├── error_widget.dart
    │   └── app_button.dart
    └── theme/
        └── app_theme.dart
```

---

## Database Tables Used by Mobile App

### `drugs`

- Used for search results display
- Key fields: `id`, `brand_name`, `brand_name_ar`, `generic_name`, `active_ingredient`, `strength`, `dosage_form`

### `inventory`

- Shown when displaying pharmacy stock
- Key fields: `id`, `drug_id`, `pharmacy_id`, `quantity`, `selling_price`, `discount_percent`, `expiry_date`, `status`
- Only show `status = 'active'` and `quantity > 0`

### `pharmacy_profiles`

- Show pharmacy name, address, city, phone, distance
- Key fields: `id`, `pharmacy_name`, `phone`, `address`, `city`, `location` (PostGIS), `status`
- Only use `status = 'approved'` pharmacies

### `reservations`

- Created when user reserves a drug
- Key fields: `id`, `user_id`, `inventory_id`, `quantity`, `short_code`, `status`, `total_price`, `expires_at`
- Status values: `pending` → `confirmed` → `expired`

### `user_profiles`

- User's name and phone
- Key fields: `id`, `full_name`, `phone`, `fcm_token`

### `notifications`

- In-app notification list
- Key fields: `id`, `user_id`, `type`, `title`, `message`, `is_read`, `created_at`

---

## API Endpoints

Base URL: `https://your-backend.com/api/v1`

All requests require: `Authorization: Bearer <supabase_jwt>`
All responses wrapped: `{ "data": {...}, "meta": { "timestamp": "..." } }`

### Auth

```
POST /auth/register     { full_name, email, phone, password }
POST /auth/login        { email, password }
POST /auth/logout
POST /auth/refresh
```

### Drug Search

```
GET  /drugs/search?q=panadol&lat=30.04&lng=31.23
```

Returns drugs with nearby pharmacy availability.

### Nearby Pharmacies for a Drug

```
GET  /drugs/:drugId/pharmacies?lat=30.04&lng=31.23&radius_km=10
```

Returns pharmacies sorted by distance with price and discount.

### Reservations

```
POST /reservations              { inventory_id, quantity }
GET  /reservations              List user's reservations
GET  /reservations/:id          Single reservation details
```

### AI Chat

```
POST /ai/chat
Body: {
  "message": "string",
  "latitude": number,          // optional
  "longitude": number,         // optional
  "conversationHistory": []    // optional, previous messages
}
Response: {
  "reply": "string",
  "updatedHistory": []
}
```

### Notifications

```
GET   /notifications            List user's notifications
PATCH /notifications/:id/read   Mark as read
POST  /notifications/fcm-token  { token: "..." }  Register FCM token
```

---

## State Management — Cubit Pattern

Each feature has one Cubit. Simple states only.

### Example: SearchCubit

```dart
// search_state.dart
abstract class SearchState {}
class SearchInitial extends SearchState {}
class SearchLoading extends SearchState {}
class SearchLoaded extends SearchState {
  final List<DrugModel> drugs;
  SearchLoaded(this.drugs);
}
class SearchError extends SearchState {
  final String message;
  SearchError(this.message);
}

// search_cubit.dart
class SearchCubit extends Cubit<SearchState> {
  final SearchRepository repository;
  SearchCubit(this.repository) : super(SearchInitial());

  Future<void> search(String query, double lat, double lng) async {
    emit(SearchLoading());
    final result = await repository.searchDrugs(query, lat, lng);
    result.fold(
      (failure) => emit(SearchError(failure.message)),
      (drugs)   => emit(SearchLoaded(drugs)),
    );
  }
}
```

### Chat Cubit — Stateful (keeps history)

```dart
// chat_state.dart
class ChatState {
  final List<ChatMessageModel> messages;
  final List<Map<String,dynamic>> history; // sent to API
  final bool isLoading;
  final String? error;
  const ChatState({...});
  ChatState copyWith({...});
}

// chat_cubit.dart
class ChatCubit extends Cubit<ChatState> {
  ChatCubit(this.repository) : super(const ChatState(messages: [], history: [], isLoading: false));

  Future<void> sendMessage(String text, {double? lat, double? lng}) async {
    // 1. Add user message to UI
    // 2. emit loading
    // 3. call repository.chat(text, history, lat, lng)
    // 4. Add AI reply to UI + update history
  }
}
```

---

## Navigation — GoRouter

```dart
final router = GoRouter(
  routes: [
    GoRoute(path: '/',        builder: (_, __) => SplashScreen()),
    GoRoute(path: '/login',   builder: (_, __) => LoginScreen()),
    GoRoute(path: '/register',builder: (_, __) => RegisterScreen()),
    GoRoute(path: '/home',    builder: (_, __) => HomeScreen()),
    GoRoute(path: '/search',  builder: (_, __) => SearchScreen()),
    GoRoute(path: '/chat',    builder: (_, __) => ChatScreen()),
    GoRoute(path: '/reservation/:id', builder: (ctx, state) =>
      ReservationScreen(id: state.pathParameters['id']!)),
    GoRoute(path: '/notifications', builder: (_, __) => NotificationsScreen()),
  ],
  redirect: (context, state) {
    final isLoggedIn = LocalStorage.hasToken();
    final isAuthRoute = state.matchedLocation == '/login' || state.matchedLocation == '/register';
    if (!isLoggedIn && !isAuthRoute) return '/login';
    if (isLoggedIn && isAuthRoute) return '/home';
    return null;
  },
);
```

---

## Authentication Flow

```
App Start
   ↓
Check token in SharedPreferences
   ↓ token exists          ↓ no token
Validate with Supabase      Login Screen
   ↓ valid    ↓ expired
Home Screen  Login Screen
```

Token storage:

```dart
// After login — save token
SharedPreferences.setString('access_token', token);
SharedPreferences.setString('refresh_token', refreshToken);

// Dio interceptor — attach to every request
options.headers['Authorization'] = 'Bearer ${LocalStorage.getToken()}';
```

---

## Key Screens

### Home Screen

- Search bar (triggers drug search)
- Quick access to: Chat, Reservations, Notifications
- Shows active reservations (if any)

### Search Screen

- Text input with debounce (300ms)
- Calls `GET /drugs/search` on each keystroke
- Shows drug list → on tap → pharmacy list

### Pharmacy List Screen

- Drug name + strength shown at top
- List of pharmacies sorted by distance
- Each card shows: name, distance, price, discount badge
- "Reserve" button on each card

### Reservation Confirmation Screen

- Short code displayed large and prominently
- Pharmacy name + address
- Drug name, quantity, price
- Expiry time countdown

### Chat Screen

- Bubble messages (user right, AI left)
- Loading indicator while AI responds
- Conversation persists in Cubit state (client-side)
- GPS sent with each message if permission granted

### Notifications Screen

- List ordered by newest first
- Unread badge on app bar icon
- Types: `reservation_confirmed`, `reservation_expired`, `reservation_reminder`

---

## Location Permission

Request at app start, not on demand:

```dart
// In SplashScreen or HomeScreen initState
final permission = await Geolocator.requestPermission();
if (permission == LocationPermission.granted) {
  final pos = await Geolocator.getCurrentPosition();
  // store in app state or pass directly to search/chat
}
```

---

## FCM Push Notifications

```dart
// Register token after login
final token = await FirebaseMessaging.instance.getToken();
await notificationsRepository.registerFcmToken(token);

// Handle foreground messages
FirebaseMessaging.onMessage.listen((message) {
  // Show local notification using flutter_local_notifications
  // Refresh notifications list
});

// Handle tap on background notification
FirebaseMessaging.onMessageOpenedApp.listen((message) {
  // Navigate based on message type
  // reservation_confirmed → go to reservation detail
  // reservation_expired   → go to home
});
```

---

## Error Handling

All API errors follow this shape from backend:

```json
{ "error": { "code": "NOT_FOUND", "message": "...", "timestamp": "..." } }
```

In Dio interceptor:

```dart
if (response.statusCode == 401) {
  // Clear token, redirect to login
}
if (response.statusCode >= 500) {
  throw ServerFailure('Something went wrong, please try again');
}
```

Never show raw error messages to user — always use friendly Arabic/English text.

---

## Recommended Packages

```yaml
dependencies:
  flutter_bloc: ^8.1.0 # Cubit
  go_router: ^14.0.0 # Navigation
  dio: ^5.4.0 # HTTP
  supabase_flutter: ^2.0.0 # Auth
  geolocator: ^13.0.0 # GPS
  flutter_map: ^7.0.0 # Maps (OpenStreetMap)
  latlong2: ^0.9.0 # Coordinates
  firebase_messaging: ^15.0.0
  flutter_local_notifications: ^17.0.0
  shared_preferences: ^2.2.0
  equatable: ^2.0.5 # State equality
  dartz: ^0.10.1 # Either for error handling
```

---

## Notes

- The app is **stateless from the server's perspective** for chat — full conversation history is sent with each message.
- Reservations lock inventory immediately on creation — no race condition handling needed on the Flutter side.
- The `short_code` is the only thing the user needs to show at the pharmacy — make it prominent.
- Drug search supports both Arabic and English input — the AI chat handles colloquial Arabic automatically.
- Only show pharmacies with `status = 'approved'` and inventory with `status = 'active'` and `quantity > 0`.

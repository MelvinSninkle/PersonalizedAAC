package io.andrewpeterson.myworld

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import io.andrewpeterson.myworld.model.DeviceMode
import io.andrewpeterson.myworld.ui.LoginView
import io.andrewpeterson.myworld.ui.RolePickerView
import io.andrewpeterson.myworld.ui.theme.Brand
import io.andrewpeterson.myworld.ui.theme.MyWorldTheme

/**
 * Single activity; Compose owns everything. The root switch mirrors
 * `ContentView.swift`: signed out → Login; role unset → RolePicker;
 * childBoard → BoardView; parent → ParentHomeView.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // AAC boards live on all day — never sleep mid-sentence.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val container = (application as MyWorldApp).container
        setContent {
            CompositionLocalProvider(LocalAppContainer provides container) {
                MyWorldTheme { RootView() }
            }
        }
    }
}

@Composable
fun RootView() {
    val c = LocalAppContainer.current
    val user by c.auth.user.collectAsState()
    val role by c.deviceMode.role.collectAsState()
    val needsOnboarding by c.onboarding.needsOnboarding.collectAsState()

    // Server-driven min/suggested build check wraps everything (UpdateGateView.kt).
    io.andrewpeterson.myworld.ui.UpdateGate {
        when {
            // Brand-new families see the demo → account → setup flow; the account
            // step's "Log in" mode is the returning-parent path. needsOnboarding
            // keeps a mid-flow parent HERE even after their account exists.
            user == null -> io.andrewpeterson.myworld.ui.onboarding.OnboardingFlow()
            needsOnboarding -> io.andrewpeterson.myworld.ui.onboarding.OnboardingFlow()
            role == DeviceMode.Role.UNSET -> RolePickerView()
            role == DeviceMode.Role.CHILD_BOARD -> io.andrewpeterson.myworld.ui.board.BoardView()
            else -> io.andrewpeterson.myworld.ui.parent.ParentHomeView()
        }
    }
}

/** Temporary M1 scaffolding; replaced as milestones land. */
@Composable
fun PlaceholderScreen(label: String) {
    Box(
        Modifier.fillMaxSize().background(Brand.bg),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = Brand.pinkDeep)
    }
}

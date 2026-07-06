plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "io.andrewpeterson.myworld"
    compileSdk = 34

    defaultConfig {
        // The NATIVE app (android-native/) now owns io.andrewpeterson.myworld;
        // this WebView shell is a dev/testing tool under a .shell suffix so
        // both can coexist on a device without upgrade collisions.
        applicationId = "io.andrewpeterson.myworld.shell"
        // minSdk 24 covers every Google Android device back to 2016 AND every
        // Kindle Fire on Fire OS 6+ (Fire OS is Android under the hood).
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.webkit:webkit:1.11.0")
}

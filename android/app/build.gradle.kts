plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}
android {
    namespace = "com.triplea.iptv"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.triplea.iptv"
        minSdk = 21
        targetSdk = 34
        versionCode = 29
        versionName = "2.21"
    }
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
    signingConfigs {
        create("release") {
            storeFile = file("../triplea.keystore")
            storePassword = "triplea123"
            keyAlias = "triplea"
            keyPassword = "triplea123"
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    configurations.configureEach {
        resolutionStrategy {
            force("androidx.collection:collection:1.2.0")
            force("com.google.guava:listenablefuture:9999.0-empty-to-avoid-conflict-with-guava")
        }
    }
    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }
}
dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.media3:media3-exoplayer:1.4.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.4.1")
}

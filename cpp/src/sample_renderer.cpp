#include "synth.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <iterator>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace {

struct Preset {
    const char *name;
    float glide;
    float vowel;
    float delay;
    float voice;
};

constexpr Preset kPresets[] = {
    {"rabten", 0.5f, 0.5f, 0.8f, 0.5f},
    {"dorje", 0.4f, 0.5f, 0.3f, 0.0f},
    {"jamyang", 0.5f, 0.5f, 0.0f, 0.75f},
    {"ngawang", 0.8f, 0.5f, 0.6f, 0.25f},
    {"tinley", 1.0f, 0.5f, 0.9f, 1.0f},
};

struct Options {
    std::filesystem::path outputPath;
    std::string presetName = "rabten";
    int midiNote = 60;
    int sampleRate = 44100;
    double holdSeconds = 1.0;
    double tailSeconds = 0.75;
    bool mono = false;

    std::optional<float> glide;
    std::optional<float> vowel;
    std::optional<float> voice;
    std::optional<float> delay;
    std::optional<float> vibrato;
    std::optional<float> vibratoRate;
    std::optional<float> aspiration;
    std::optional<float> attack;
    std::optional<float> decay;
    std::optional<float> sustain;
    std::optional<float> release;
    std::optional<int> unison;
    std::optional<float> detune;
    std::optional<float> delayRate;
    std::optional<float> level;
    std::optional<float> voiceSpread;
};

std::string toLower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(),
                   [](unsigned char ch) { return static_cast<char>(std::tolower(ch)); });
    return value;
}

const Preset *findPreset(const std::string &name) {
    const std::string lowered = toLower(name);
    for (const auto &preset : kPresets) {
        if (lowered == preset.name)
            return &preset;
    }
    return nullptr;
}

void writeLe16(std::ostream &out, std::uint16_t value) {
    out.put(static_cast<char>(value & 0xFFu));
    out.put(static_cast<char>((value >> 8u) & 0xFFu));
}

void writeLe32(std::ostream &out, std::uint32_t value) {
    out.put(static_cast<char>(value & 0xFFu));
    out.put(static_cast<char>((value >> 8u) & 0xFFu));
    out.put(static_cast<char>((value >> 16u) & 0xFFu));
    out.put(static_cast<char>((value >> 24u) & 0xFFu));
}

std::optional<int> parseInt(std::string_view text) {
    try {
        size_t idx = 0;
        const int value = std::stoi(std::string(text), &idx, 10);
        if (idx != text.size())
            return std::nullopt;
        return value;
    } catch (...) {
        return std::nullopt;
    }
}

std::optional<float> parseFloat(std::string_view text) {
    try {
        size_t idx = 0;
        const float value = std::stof(std::string(text), &idx);
        if (idx != text.size())
            return std::nullopt;
        return value;
    } catch (...) {
        return std::nullopt;
    }
}

std::optional<int> parseNoteName(std::string noteText) {
    if (noteText.size() < 2)
        return std::nullopt;

    noteText = toLower(noteText);
    const char letter = noteText[0];
    int semitone = 0;
    switch (letter) {
    case 'c':
        semitone = 0;
        break;
    case 'd':
        semitone = 2;
        break;
    case 'e':
        semitone = 4;
        break;
    case 'f':
        semitone = 5;
        break;
    case 'g':
        semitone = 7;
        break;
    case 'a':
        semitone = 9;
        break;
    case 'b':
        semitone = 11;
        break;
    default:
        return std::nullopt;
    }

    std::size_t idx = 1;
    if (idx < noteText.size() && noteText[idx] == '#') {
        semitone += 1;
        idx++;
    } else if (idx < noteText.size() && noteText[idx] == 'b') {
        semitone -= 1;
        idx++;
    }

    if (idx < noteText.size() && noteText[idx] == '-' && idx + 1 < noteText.size() &&
        std::isdigit(static_cast<unsigned char>(noteText[idx + 1]))) {
        idx++;
    }

    const auto octave = parseInt(std::string_view(noteText).substr(idx));
    if (!octave)
        return std::nullopt;

    const int midi = (*octave + 1) * 12 + semitone;
    if (midi < 0 || midi > 127)
        return std::nullopt;
    return midi;
}

std::string formatMidiNote(int midi) {
    static constexpr const char *kNames[] = {"C",  "C#", "D",  "D#", "E",  "F",
                                             "F#", "G",  "G#", "A",  "A#", "B"};
    if (midi < 0 || midi > 127)
        return "n/a";
    const int semitone = midi % 12;
    const int octave = midi / 12 - 1;
    return std::string(kNames[semitone]) + std::to_string(octave);
}

void printUsage(std::ostream &out) {
    out <<
        "Usage: monksynth-render --output PATH [options]\n"
        "\n"
        "Render a MonkSynth note to a WAV file suitable for loading into a\n"
        "nanoTracker project's samples directory.\n"
        "\n"
        "Core options:\n"
        "  --output PATH          Output WAV path (required)\n"
        "  --preset NAME          rabten, dorje, jamyang, ngawang, tinley\n"
        "  --note NAME            Note name like C4, C-4, F#3\n"
        "  --midi-note N          MIDI note number (0..127)\n"
        "  --tracker-note N       nanoTracker note number (1..96)\n"
        "  --duration SEC         Held note duration before note-off\n"
        "  --tail SEC             Extra render time after note-off\n"
        "  --sample-rate HZ       Output sample rate (default 44100)\n"
        "  --mono                 Render mono instead of stereo\n"
        "\n"
        "Parameter overrides:\n"
        "  --glide V              0..1\n"
        "  --vowel V              0..1\n"
        "  --voice V              0..1\n"
        "  --delay V              0..1\n"
        "  --vibrato V            0..1\n"
        "  --vibrato-rate V       0..1\n"
        "  --aspiration V         0..1\n"
        "  --attack SEC           seconds\n"
        "  --decay SEC            seconds\n"
        "  --sustain V            0..1\n"
        "  --release SEC          seconds\n"
        "  --unison N             1..10\n"
        "  --detune CENTS         detune spread in cents\n"
        "  --delay-rate V         0..1\n"
        "  --level V              0..1\n"
        "  --voice-spread V       0..1\n";
}

bool requireRange(const char *name, float value, float minValue, float maxValue) {
    if (value < minValue || value > maxValue) {
        std::cerr << name << " must be between " << minValue << " and " << maxValue << ".\n";
        return false;
    }
    return true;
}

bool writeWav(const Options &options, std::vector<float> left, std::vector<float> right) {
    if (left.size() != right.size()) {
        std::cerr << "Internal error: channel length mismatch.\n";
        return false;
    }

    const std::size_t frames = left.size();
    const int channelCount = options.mono ? 1 : 2;
    std::vector<float> samples;
    samples.reserve(frames * static_cast<std::size_t>(channelCount));

    float peak = 0.0f;
    for (std::size_t i = 0; i < frames; i++) {
        if (options.mono) {
            const float mono = 0.5f * (left[i] + right[i]);
            peak = std::max(peak, std::abs(mono));
            samples.push_back(mono);
            continue;
        }

        peak = std::max(peak, std::abs(left[i]));
        peak = std::max(peak, std::abs(right[i]));
        samples.push_back(left[i]);
        samples.push_back(right[i]);
    }

    if (peak <= std::numeric_limits<float>::epsilon()) {
        std::cerr << "Rendered silence; refusing to write an empty sample.\n";
        return false;
    }

    const float scale = peak > 0.999f ? 0.999f / peak : 1.0f;
    for (float &sample : samples)
        sample = std::clamp(sample * scale, -1.0f, 1.0f);

    std::error_code ec;
    const auto parent = options.outputPath.parent_path();
    if (!parent.empty())
        std::filesystem::create_directories(parent, ec);
    if (ec) {
        std::cerr << "Failed to create output directory: " << ec.message() << "\n";
        return false;
    }

    std::ofstream out(options.outputPath, std::ios::binary | std::ios::trunc);
    if (!out) {
        std::cerr << "Failed to open output file: " << options.outputPath << "\n";
        return false;
    }

    const std::uint16_t bitsPerSample = 16;
    const std::uint16_t blockAlign = static_cast<std::uint16_t>(channelCount * bitsPerSample / 8);
    const std::uint32_t byteRate = static_cast<std::uint32_t>(options.sampleRate) * blockAlign;
    const std::uint32_t dataSize = static_cast<std::uint32_t>(samples.size() * sizeof(std::int16_t));

    out.write("RIFF", 4);
    writeLe32(out, 36u + dataSize);
    out.write("WAVE", 4);
    out.write("fmt ", 4);
    writeLe32(out, 16u);
    writeLe16(out, 1u);
    writeLe16(out, static_cast<std::uint16_t>(channelCount));
    writeLe32(out, static_cast<std::uint32_t>(options.sampleRate));
    writeLe32(out, byteRate);
    writeLe16(out, blockAlign);
    writeLe16(out, bitsPerSample);
    out.write("data", 4);
    writeLe32(out, dataSize);

    for (float sample : samples) {
        const auto pcm = static_cast<std::int16_t>(std::lrintf(sample * 32767.0f));
        writeLe16(out, static_cast<std::uint16_t>(pcm));
    }

    if (!out) {
        std::cerr << "Failed while writing WAV data.\n";
        return false;
    }

    std::cout << "Rendered " << options.outputPath << "\n";
    std::cout << "  note: " << formatMidiNote(options.midiNote) << " (midi " << options.midiNote;
    if (options.midiNote >= 12 && options.midiNote <= 107)
        std::cout << ", tracker " << (options.midiNote - 11);
    std::cout << ")\n";
    std::cout << "  preset: " << options.presetName << "\n";
    std::cout << "  sample rate: " << options.sampleRate << " Hz\n";
    std::cout << "  channels: " << channelCount << "\n";
    std::cout << "  frames: " << frames << "\n";
    std::cout << "  clip protection scale: " << scale << "\n";

    return true;
}

bool parseArgs(int argc, char **argv, Options &options) {
    if (argc <= 1) {
        printUsage(std::cerr);
        return false;
    }

    auto nextValue = [&](int &index) -> std::optional<std::string_view> {
        if (index + 1 >= argc) {
            std::cerr << "Missing value for " << argv[index] << ".\n";
            return std::nullopt;
        }
        index++;
        return std::string_view(argv[index]);
    };

    for (int i = 1; i < argc; i++) {
        const std::string_view arg(argv[i]);
        if (arg == "--help" || arg == "-h") {
            printUsage(std::cout);
            std::exit(0);
        }
        if (arg == "--output") {
            const auto value = nextValue(i);
            if (!value)
                return false;
            options.outputPath = std::filesystem::path(*value);
            continue;
        }
        if (arg == "--preset") {
            const auto value = nextValue(i);
            if (!value)
                return false;
            options.presetName = toLower(std::string(*value));
            continue;
        }
        if (arg == "--note") {
            const auto value = nextValue(i);
            if (!value)
                return false;
            const auto midi = parseNoteName(std::string(*value));
            if (!midi) {
                std::cerr << "Invalid note name: " << *value << "\n";
                return false;
            }
            options.midiNote = *midi;
            continue;
        }
        if (arg == "--midi-note") {
            const auto value = nextValue(i);
            if (!value)
                return false;
            const auto midi = parseInt(*value);
            if (!midi || *midi < 0 || *midi > 127) {
                std::cerr << "MIDI note must be between 0 and 127.\n";
                return false;
            }
            options.midiNote = *midi;
            continue;
        }
        if (arg == "--tracker-note") {
            const auto value = nextValue(i);
            if (!value)
                return false;
            const auto tracker = parseInt(*value);
            if (!tracker || *tracker < 1 || *tracker > 96) {
                std::cerr << "Tracker note must be between 1 and 96.\n";
                return false;
            }
            options.midiNote = *tracker + 11;
            continue;
        }
        if (arg == "--duration") {
            const auto value = nextValue(i);
            if (!value)
                return false;
            const auto parsed = parseFloat(*value);
            if (!parsed || *parsed < 0.0f) {
                std::cerr << "Duration must be >= 0.\n";
                return false;
            }
            options.holdSeconds = *parsed;
            continue;
        }
        if (arg == "--tail") {
            const auto value = nextValue(i);
            if (!value)
                return false;
            const auto parsed = parseFloat(*value);
            if (!parsed || *parsed < 0.0f) {
                std::cerr << "Tail must be >= 0.\n";
                return false;
            }
            options.tailSeconds = *parsed;
            continue;
        }
        if (arg == "--sample-rate") {
            const auto value = nextValue(i);
            if (!value)
                return false;
            const auto parsed = parseInt(*value);
            if (!parsed || *parsed < 8000) {
                std::cerr << "Sample rate must be >= 8000.\n";
                return false;
            }
            options.sampleRate = *parsed;
            continue;
        }
        if (arg == "--mono") {
            options.mono = true;
            continue;
        }
        if (arg == "--stereo") {
            options.mono = false;
            continue;
        }

        auto parseFloatOpt = [&](std::optional<float> &slot) -> bool {
            const auto value = nextValue(i);
            if (!value)
                return false;
            const auto parsed = parseFloat(*value);
            if (!parsed) {
                std::cerr << "Invalid value for " << arg << ".\n";
                return false;
            }
            slot = *parsed;
            return true;
        };

        if (arg == "--glide") {
            if (!parseFloatOpt(options.glide))
                return false;
            continue;
        }
        if (arg == "--vowel") {
            if (!parseFloatOpt(options.vowel))
                return false;
            continue;
        }
        if (arg == "--voice") {
            if (!parseFloatOpt(options.voice))
                return false;
            continue;
        }
        if (arg == "--delay") {
            if (!parseFloatOpt(options.delay))
                return false;
            continue;
        }
        if (arg == "--vibrato") {
            if (!parseFloatOpt(options.vibrato))
                return false;
            continue;
        }
        if (arg == "--vibrato-rate") {
            if (!parseFloatOpt(options.vibratoRate))
                return false;
            continue;
        }
        if (arg == "--aspiration") {
            if (!parseFloatOpt(options.aspiration))
                return false;
            continue;
        }
        if (arg == "--attack") {
            if (!parseFloatOpt(options.attack))
                return false;
            continue;
        }
        if (arg == "--decay") {
            if (!parseFloatOpt(options.decay))
                return false;
            continue;
        }
        if (arg == "--sustain") {
            if (!parseFloatOpt(options.sustain))
                return false;
            continue;
        }
        if (arg == "--release") {
            if (!parseFloatOpt(options.release))
                return false;
            continue;
        }
        if (arg == "--detune") {
            if (!parseFloatOpt(options.detune))
                return false;
            continue;
        }
        if (arg == "--delay-rate") {
            if (!parseFloatOpt(options.delayRate))
                return false;
            continue;
        }
        if (arg == "--level") {
            if (!parseFloatOpt(options.level))
                return false;
            continue;
        }
        if (arg == "--voice-spread") {
            if (!parseFloatOpt(options.voiceSpread))
                return false;
            continue;
        }
        if (arg == "--unison") {
            const auto value = nextValue(i);
            if (!value)
                return false;
            const auto parsed = parseInt(*value);
            if (!parsed) {
                std::cerr << "Invalid value for --unison.\n";
                return false;
            }
            options.unison = *parsed;
            continue;
        }

        std::cerr << "Unknown option: " << arg << "\n";
        return false;
    }

    if (options.outputPath.empty()) {
        std::cerr << "--output is required.\n";
        return false;
    }

    if (options.holdSeconds <= 0.0 && options.tailSeconds <= 0.0) {
        std::cerr << "Total render time must be > 0.\n";
        return false;
    }

    const auto preset = findPreset(options.presetName);
    if (!preset) {
        std::cerr << "Unknown preset: " << options.presetName << "\n";
        return false;
    }

    const std::optional<float> normalizedParams[] = {
        options.glide,       options.vowel,      options.voice,      options.delay,
        options.vibrato,     options.vibratoRate, options.aspiration, options.sustain,
        options.delayRate,   options.level,      options.voiceSpread,
    };
    const char *normalizedNames[] = {"--glide",      "--vowel",       "--voice",      "--delay",
                                     "--vibrato",    "--vibrato-rate", "--aspiration", "--sustain",
                                     "--delay-rate", "--level",       "--voice-spread"};
    for (std::size_t i = 0; i < std::size(normalizedParams); i++) {
        if (normalizedParams[i] && !requireRange(normalizedNames[i], *normalizedParams[i], 0.0f, 1.0f))
            return false;
    }

    const std::optional<float> positiveTimes[] = {options.attack, options.decay, options.release};
    const char *positiveNames[] = {"--attack", "--decay", "--release"};
    for (std::size_t i = 0; i < std::size(positiveTimes); i++) {
        if (positiveTimes[i] && *positiveTimes[i] < 0.0f) {
            std::cerr << positiveNames[i] << " must be >= 0.\n";
            return false;
        }
    }

    if (options.unison && (*options.unison < 1 || *options.unison > 10)) {
        std::cerr << "--unison must be between 1 and 10.\n";
        return false;
    }

    if (options.detune && *options.detune < 0.0f) {
        std::cerr << "--detune must be >= 0.\n";
        return false;
    }

    return true;
}

void applyParameters(MonkSynthEngine *synth, const Options &options) {
    const Preset *preset = findPreset(options.presetName);
    monk_synth_set_glide(synth, preset->glide);
    monk_synth_set_vowel(synth, preset->vowel);
    monk_synth_set_delay_mix(synth, preset->delay);
    monk_synth_set_voice(synth, preset->voice);

    monk_synth_set_vibrato(synth, 0.0f);
    monk_synth_set_vibrato_rate(synth, 0.5f);
    monk_synth_set_aspiration(synth, 0.5f);
    monk_synth_set_attack(synth, 0.0f);
    monk_synth_set_decay(synth, 0.0f);
    monk_synth_set_sustain(synth, 1.0f);
    monk_synth_set_release(synth, 0.0f);
    monk_synth_set_unison(synth, 1);
    monk_synth_set_unison_detune(synth, 0.0f);
    monk_synth_set_unison_voice_spread(synth, 0.0f);
    monk_synth_set_delay_rate(synth, 0.5f);
    monk_synth_set_volume(synth, 1.0f);
    monk_synth_set_level(synth, 1.0f);

    if (options.glide)
        monk_synth_set_glide(synth, *options.glide);
    if (options.vowel)
        monk_synth_set_vowel(synth, *options.vowel);
    if (options.voice)
        monk_synth_set_voice(synth, *options.voice);
    if (options.delay)
        monk_synth_set_delay_mix(synth, *options.delay);
    if (options.vibrato)
        monk_synth_set_vibrato(synth, *options.vibrato);
    if (options.vibratoRate)
        monk_synth_set_vibrato_rate(synth, *options.vibratoRate);
    if (options.aspiration)
        monk_synth_set_aspiration(synth, *options.aspiration);
    if (options.attack)
        monk_synth_set_attack(synth, *options.attack);
    if (options.decay)
        monk_synth_set_decay(synth, *options.decay);
    if (options.sustain)
        monk_synth_set_sustain(synth, *options.sustain);
    if (options.release)
        monk_synth_set_release(synth, *options.release);
    if (options.unison)
        monk_synth_set_unison(synth, *options.unison);
    if (options.detune)
        monk_synth_set_unison_detune(synth, *options.detune);
    if (options.delayRate)
        monk_synth_set_delay_rate(synth, *options.delayRate);
    if (options.level)
        monk_synth_set_level(synth, *options.level);
    if (options.voiceSpread)
        monk_synth_set_unison_voice_spread(synth, *options.voiceSpread);
}

} // namespace

int main(int argc, char **argv) {
    Options options;
    if (!parseArgs(argc, argv, options))
        return 1;

    MonkSynthEngine *synth = monk_synth_new(static_cast<float>(options.sampleRate));
    if (!synth) {
        std::cerr << "Failed to initialize MonkSynth engine.\n";
        return 1;
    }

    applyParameters(synth, options);

    const std::size_t holdFrames =
        static_cast<std::size_t>(std::llround(options.holdSeconds * options.sampleRate));
    const std::size_t tailFrames =
        static_cast<std::size_t>(std::llround(options.tailSeconds * options.sampleRate));
    const std::size_t totalFrames = holdFrames + tailFrames;
    std::vector<float> left(totalFrames, 0.0f);
    std::vector<float> right(totalFrames, 0.0f);
    std::vector<float> blockLeft(512, 0.0f);
    std::vector<float> blockRight(512, 0.0f);

    monk_synth_note_on(synth, static_cast<std::uint8_t>(options.midiNote), 1.0f);

    std::size_t offset = 0;
    while (offset < holdFrames) {
        const std::size_t blockSize = std::min<std::size_t>(blockLeft.size(), holdFrames - offset);
        monk_synth_process(synth, blockLeft.data(), blockRight.data(), static_cast<std::uint32_t>(blockSize));
        std::copy_n(blockLeft.begin(), blockSize, left.begin() + offset);
        std::copy_n(blockRight.begin(), blockSize, right.begin() + offset);
        offset += blockSize;
    }

    monk_synth_note_off(synth, static_cast<std::uint8_t>(options.midiNote));

    while (offset < totalFrames) {
        const std::size_t blockSize = std::min<std::size_t>(blockLeft.size(), totalFrames - offset);
        monk_synth_process(synth, blockLeft.data(), blockRight.data(), static_cast<std::uint32_t>(blockSize));
        std::copy_n(blockLeft.begin(), blockSize, left.begin() + offset);
        std::copy_n(blockRight.begin(), blockSize, right.begin() + offset);
        offset += blockSize;
    }

    monk_synth_free(synth);

    if (!writeWav(options, std::move(left), std::move(right)))
        return 1;

    return 0;
}

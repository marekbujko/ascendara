import React, { useState, useEffect, useRef, useCallback, memo } from "react";
import { createPortal } from "react-dom";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/context/LanguageContext";
import { useLibrarySearch } from "@/hooks/useLibrarySearch";
import {
  Plus,
  FolderOpen,
  ExternalLink,
  User,
  HardDrive,
  Gamepad2,
  Gift,
  Search as SearchIcon,
  AlertTriangle,
  Heart,
  SquareLibrary,
  Tag,
  PackageOpen,
  Loader,
  Import,
  AlertCircle,
  CheckSquareIcon,
  SortAscIcon,
  ArrowUpAZ,
  ArrowDownAZ,
  ImageUp,
  FolderPlus,
  ChevronDown,
  ChevronUp,
  Cloud,
  CloudDownload,
  CloudUpload,
  Clock,
  DollarSign,
  ArrowDown,
  Play,
  Trash2,
  Sparkles,
  MessageSquareText,
  TriangleAlert,
  Layers,
  Timer,
  HardDriveDownload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogCancel,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Separator } from "@/components/ui/separator";
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import gameService from "@/services/gameService";
import { safeSetItem } from "@/services/gameInfoCacheService";
import { toast } from "sonner";
import { useLocation, useNavigate } from "react-router-dom";
import steamService from "@/services/gameInfoService";
import { useSettings } from "@/context/SettingsContext";
import { useAuth } from "@/context/AuthContext";
import {
  getCloudLibrary,
  getGameAchievements,
  syncCloudLibrary,
  syncGameAchievements,
  verifyAscendAccess,
  getFriendsList,
} from "@/services/firebaseService";
import { calculateLibraryValue } from "@/services/cheapsharkService";

import NewFolderDialog from "@/components/NewFolderDialog";
import FolderCard from "@/components/FolderCard";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import {
  loadFolders,
  saveFolders,
  createFolder,
  addGameToFolder,
  filterGamesNotInFolders,
  getGamesInFolders,
} from "@/lib/folderManager";

// Module-level cache so images survive page switches without re-fetching via IPC
const gameImageCache = new Map();

const Library = () => {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedGames, setSelectedGames] = useState([]);
  const handleSelectGame = game => {
    if (!game.isCustom) return;
    setSelectedGames(prev =>
      prev.includes(game.game) ? prev.filter(g => g !== game.game) : [...prev, game.game]
    );
  };

  // Bulk remove selected custom games
  const handleBulkRemove = async () => {
    if (selectedGames.length === 0) return;
    try {
      for (const gameName of selectedGames) {
        await window.electron.removeCustomGame(gameName);
      }
      setSelectedGames([]);
      setSelectionMode(false);
      await loadGames();
    } catch (error) {
      console.error("Bulk remove failed:", error);
    }
  };

  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAddGameOpen, setIsAddGameOpen] = useState(false);
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState(() => {
    const saved = localStorage.getItem("library-sortOrder");
    return saved || "asc";
  });
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [filters, setFilters] = useState({
    favorites: false,
    vrOnly: false,
    onlineGames: false,
  });
  const [lastLaunchedGame, setLastLaunchedGame] = useState(null);
  const lastLaunchedGameRef = useRef(null);
  const [isOnWindows, setIsOnWindows] = useState(true);
  const [coverSearchQuery, setCoverSearchQuery] = useState("");
  const [coverSearchResults, setCoverSearchResults] = useState([]);
  const [isCoverSearchLoading, setIsCoverSearchLoading] = useState(false);
  const [selectedGameImage, setSelectedGameImage] = useState(null);
  const [storageInfo, setStorageInfo] = useState(null);
  const [username, setUsername] = useState(null);
  const [favorites, setFavorites] = useState(() => {
    const savedFavorites = localStorage.getItem("game-favorites");
    return savedFavorites ? JSON.parse(savedFavorites) : [];
  });
  const [totalGamesSize, setTotalGamesSize] = useState(0);
  const [isCalculatingSize, setIsCalculatingSize] = useState(false);
  const [showStorageDetails, setShowStorageDetails] = useState(false);
  const [folders, setFolders] = useState(() => {
    const savedFolders = localStorage.getItem("library-folders");
    return savedFolders ? JSON.parse(savedFolders) : [];
  });
  // Cloud-only games state
  const [cloudOnlyGames, setCloudOnlyGames] = useState([]);
  const [loadingCloudGames, setLoadingCloudGames] = useState(false);
  const [restoringGame, setRestoringGame] = useState(null);
  const [cloudGameImages, setCloudGameImages] = useState({});
  // Play Later games state
  const [playLaterGames, setPlayLaterGames] = useState([]);
  const [isSyncingLibrary, setIsSyncingLibrary] = useState(false);
  const [gameUpdates, setGameUpdates] = useState({}); // {gameID: updateInfo}
  const [isLibraryValueOpen, setIsLibraryValueOpen] = useState(false);
  const [libraryValueData, setLibraryValueData] = useState(() => {
    const cached = localStorage.getItem("library-value-cache");
    return cached ? JSON.parse(cached) : null;
  });
  const [cachedGameCount, setCachedGameCount] = useState(() => {
    return parseInt(localStorage.getItem("library-value-game-count") || "0", 10);
  });
  const [isCalculatingValue, setIsCalculatingValue] = useState(false);
  const [valueProgress, setValueProgress] = useState({ current: 0, total: 0, game: "" });
  const [activeTab, setActiveTab] = useState("all"); // "all" | "favorites" | "cloud" | "playLater"
  const [groupBy, setGroupBy] = useState(() => localStorage.getItem("library-groupBy") || "none"); // "none" | "directory"
  const [sortMode, setSortMode] = useState(() => localStorage.getItem("library-sortMode") || "alpha"); // "alpha" | "playtime"
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, userData } = useAuth();
  const { settings } = useSettings();
  const [ascendAccess, setAscendAccess] = useState({
    hasAccess: false,
    isSubscribed: false,
    isVerified: false,
  });
  const [showAscendPanel, setShowAscendPanel] = useState(false);
  const [friends, setFriends] = useState([]);
  const [friendsLoaded, setFriendsLoaded] = useState(false);
  const [showRedesignDialog, setShowRedesignDialog] = useState(false);

  useEffect(() => {
    safeSetItem("game-favorites", JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    const checkRedesignDialog = async () => {
      const alreadyShown = localStorage.getItem("library-redesign-welcome-shown");
      if (alreadyShown) return;
      try {
        const hasLaunched = await window.electron.hasLaunched();
        if (hasLaunched) {
          setTimeout(() => setShowRedesignDialog(true), 800);
        }
      } catch (e) {
        console.error("Failed to check launch status for redesign dialog:", e);
      }
    };
    checkRedesignDialog();
  }, []);

  useLibrarySearch();

  // Verify Ascend access
  useEffect(() => {
    const checkAscendAccess = async () => {
      if (!user) {
        setAscendAccess({
          hasAccess: false,
          isSubscribed: false,
          isVerified: false,
        });
        return;
      }

      try {
        const result = await verifyAscendAccess();
        setAscendAccess({
          hasAccess: result.hasAccess,
          isSubscribed: result.isSubscribed,
          isVerified: result.isVerified,
        });
      } catch (error) {
        console.error("Error verifying Ascend access:", error);
        setAscendAccess({
          hasAccess: false,
          isSubscribed: false,
          isVerified: false,
        });
      }
    };

    checkAscendAccess();
  }, [user]);

  useEffect(() => {
    const checkWindows = async () => {
      const isWindows = await window.electron.isOnWindows();
      setIsOnWindows(isWindows);
    };
    checkWindows();
  }, []);

  useEffect(() => {
    // Add keyframes to document
    const styleSheet = document.styleSheets[0];
    const keyframes = `
      @keyframes shimmer {
        0% { transform: translateX(-100%) }
        100% { transform: translateX(100%) }
      }
    `;
    styleSheet.insertRule(keyframes, styleSheet.cssRules.length);
  }, []);

  useEffect(() => {
    lastLaunchedGameRef.current = lastLaunchedGame;
  }, [lastLaunchedGame]);

  const [currentPage, setCurrentPage] = useState(() => {
    const statePage = Number(location?.state?.libraryPage);
    // // //
    return Number.isInteger(statePage) && statePage >= 1 ? statePage : 1;
  });

  const PAGE_SIZE = 15;

  // Filter games based on search query
  const filteredGames = games
    .slice()
    .filter(game => {
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = (game.game || game.name || "")
        .toLowerCase()
        .includes(searchLower);
      const matchesFavorites =
        !filters.favorites || favorites.includes(game.game || game.name);
      const matchesVr = !filters.vrOnly || game.isVr;
      const matchesOnline = !filters.onlineGames || game.online;
      return matchesSearch && matchesFavorites && matchesVr && matchesOnline;
    })
    .sort((a, b) => {
      // Folders always first
      if (a.isFolder && !b.isFolder) return -1;
      if (!a.isFolder && b.isFolder) return 1;
      // Then favorites
      const aName = a.game || a.name || "";
      const bName = b.game || b.name || "";
      const aFavorite = favorites.includes(aName);
      const bFavorite = favorites.includes(bName);
      if (aFavorite !== bFavorite) {
        return aFavorite ? -1 : 1;
      }
      // Sort mode
      if (sortMode === "playtime") {
        const aTime = a.playTime || 0;
        const bTime = b.playTime || 0;
        return bTime - aTime;
      }
      // Alphabetical
      return sortOrder === "asc"
        ? aName.localeCompare(bName)
        : bName.localeCompare(aName);
    });

  // Save sortOrder/groupBy/sortMode to localStorage whenever they change
  useEffect(() => {
    safeSetItem("library-sortOrder", sortOrder);
  }, [sortOrder]);

  useEffect(() => {
    safeSetItem("library-groupBy", groupBy);
  }, [groupBy]);

  useEffect(() => {
    safeSetItem("library-sortMode", sortMode);
  }, [sortMode]);

  // Pagination logic
  const totalPages = Math.ceil(filteredGames.length / PAGE_SIZE);
  const paginatedGames = filteredGames.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  // Listen for folder changes (e.g. folder deleted, games moved back)
  useEffect(() => {
    const handleFoldersUpdated = () => {
      loadGames();
    };
    window.addEventListener("ascendara:folders-updated", handleFoldersUpdated);
    return () => {
      window.removeEventListener("ascendara:folders-updated", handleFoldersUpdated);
    };
  }, []);

  // Scroll to top when page changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentPage]);

  // Keep current page in range. Avoid resetting during initial load when totalPages is 0.
  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const toggleFavorite = gameName => {
    setFavorites(prev => {
      const newFavorites = prev.includes(gameName)
        ? prev.filter(name => name !== gameName)
        : [...prev, gameName];
      return newFavorites;
    });
  };

  const fetchUsername = async () => {
    try {
      // Get username from localStorage with fallback to API
      const userPrefs = JSON.parse(localStorage.getItem("userProfile") || "{}");
      if (userPrefs.profileName) {
        setUsername(userPrefs.profileName);
        return userPrefs.profileName;
      }

      // Fallback to Electron API if not in localStorage
      const crackedUsername = await window.electron.getLocalCrackUsername();
      setUsername(crackedUsername || "Guest");
      return crackedUsername;
    } catch (error) {
      console.error("Error fetching username:", error);
      setUsername("Guest");
      return null;
    }
  };

  const formatBytes = bytes => {
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    if (bytes === 0) return "0 Byte";
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
  };

  useEffect(() => {
    const fetchStorageInfo = async () => {
      try {
        const installPath = await window.electron.getDownloadDirectory();
        if (installPath) {
          const [driveSpace, gamesSize] = await Promise.all([
            window.electron.getDriveSpace(installPath),
            window.electron.getInstalledGamesSize(),
          ]);

          // Use the actual directory-specific game sizes from the backend
          if (
            driveSpace &&
            driveSpace.directories &&
            driveSpace.directories.length > 0 &&
            gamesSize.success &&
            !gamesSize.calculating &&
            gamesSize.directorySizes
          ) {
            // Map the drive space directories with their corresponding game sizes
            const directoriesWithGameSizes = driveSpace.directories.map(dir => {
              // Find the matching directory in the game sizes data
              const matchingDir = gamesSize.directorySizes.find(
                gameSizeDir => gameSizeDir.path === dir.path
              );

              return {
                ...dir,
                gamesSize: matchingDir ? matchingDir.size : 0,
              };
            });

            setStorageInfo({
              ...driveSpace,
              directories: directoriesWithGameSizes,
            });
          } else {
            setStorageInfo(driveSpace);
          }

          if (gamesSize.success) {
            setIsCalculatingSize(gamesSize.calculating);
            if (!gamesSize.calculating) {
              setTotalGamesSize(gamesSize.totalSize);
            }
          }
        }
      } catch (error) {
        console.error("Error fetching storage info:", error);
      }
    };

    fetchStorageInfo();
  }, []);

  useEffect(() => {
    fetchUsername();
  }, []);

  // Keep track of whether we've initialized
  const [isInitialized, setIsInitialized] = useState(false);

  // Initialize once on mount
  useEffect(() => {
    const init = async () => {
      await loadGames();
      setIsInitialized(true);
    };
    init();
  }, []);

  // Load Play Later games from localStorage
  useEffect(() => {
    const loadPlayLaterGames = () => {
      const savedGames = JSON.parse(localStorage.getItem("play-later-games") || "[]");
      setPlayLaterGames(savedGames);
    };

    loadPlayLaterGames();

    // Listen for updates from GameCard
    const handlePlayLaterUpdate = () => {
      loadPlayLaterGames();
    };
    window.addEventListener("play-later-updated", handlePlayLaterUpdate);

    return () => {
      window.removeEventListener("play-later-updated", handlePlayLaterUpdate);
    };
  }, []);

  // Handle removing a game from Play Later list
  const handleRemoveFromPlayLater = gameName => {
    const updatedList = playLaterGames.filter(g => g.game !== gameName);
    safeSetItem("play-later-games", JSON.stringify(updatedList));
    localStorage.removeItem(`play-later-image-${gameName}`);
    setPlayLaterGames(updatedList);
  };

  // Handle navigating to download page for Play Later game
  const handleDownloadPlayLater = game => {
    // Remove from Play Later list and cached image
    handleRemoveFromPlayLater(game.game);

    navigate("/download", {
      state: {
        gameData: game,
      },
    });
  };

  // Check for game updates when games are loaded (only for Ascend subscribers)
  useEffect(() => {
    const checkGameUpdates = async () => {
      console.log("[Library] checkGameUpdates called, games:", games.length);

      // Only check if user has Ascend access
      if (!user || !ascendAccess.hasAccess) {
        console.log("[Library] Skipping update check - no Ascend access");
        setGameUpdates({});
        return;
      }

      // Only check for non-custom games with gameID
      const gamesWithId = games.filter(g => !g.isFolder && !g.isCustom && g.gameID);
      console.log(
        "[Library] Games with gameID:",
        gamesWithId.length,
        gamesWithId.map(g => ({ name: g.game, gameID: g.gameID, version: g.version }))
      );
      if (gamesWithId.length === 0) {
        console.log("[Library] No games with gameID found, skipping update check");
        return;
      }

      const updates = {};
      // Check updates in parallel but limit concurrency
      const checkPromises = gamesWithId.map(async game => {
        try {
          console.log(
            `[Library] Checking update for ${game.game} (${game.gameID}), version: ${game.version}`
          );
          const result = await gameService.checkGameUpdate(game.gameID, game.version);
          console.log(`[Library] Update result for ${game.game}:`, result);
          if (result?.updateAvailable) {
            console.log(`[Library] Update available for ${game.game}!`);
            updates[game.gameID] = result;
          }
        } catch (error) {
          console.error(`[Library] Error checking update for ${game.game}:`, error);
        }
      });

      await Promise.all(checkPromises);
      console.log("[Library] All updates checked, updates found:", updates);
      setGameUpdates(updates);
    };

    if (isInitialized && games.length > 0) {
      console.log(
        "[Library] Triggering update check, isInitialized:",
        isInitialized,
        "games.length:",
        games.length,
        "hasAccess:",
        ascendAccess.hasAccess
      );
      checkGameUpdates();
    }
  }, [isInitialized, games, user, ascendAccess.hasAccess]);

  // Load cloud-only games (games in cloud but not installed locally)
  useEffect(() => {
    const loadCloudOnlyGames = async () => {
      if (!user) {
        setCloudOnlyGames([]);
        return;
      }

      setLoadingCloudGames(true);
      try {
        const cloudResult = await getCloudLibrary();
        if (cloudResult.data?.games) {
          // Get local game names for comparison
          const installedGames = await window.electron.getGames();
          const customGames = await window.electron.getCustomGames();
          
          // Sanitize game name to match backend directory naming
          const sanitizeName = (name) => {
            if (!name) return "";
            return name.replace(/[<>:"/\\|?*]/g, "").trim().toLowerCase();
          };
          
          const localGameNames = new Set([
            ...(installedGames || []).map(g => sanitizeName(g.game || g.name)),
            ...(customGames || []).map(g => sanitizeName(g.game || g.name)),
          ]);

          // Filter to cloud games that are NOT installed locally
          // Include both regular games (with gameID) and custom games
          const cloudOnly = cloudResult.data.games.filter(
            g => !localGameNames.has(sanitizeName(g.name)) && (g.gameID || g.isCustom)
          );

          setCloudOnlyGames(cloudOnly);

          // Load images for cloud-only games (only for non-custom games with gameID).
          // Image data URLs are NOT cached in localStorage (quota issues); React
          // state holds them in-memory for the lifetime of the page.
          const images = {};
          for (const game of cloudOnly
            .filter(g => g.gameID && !g.isCustom)
            .slice(0, 20)) {
            try {
              if (game.gameID) {
                // For local index, we need to find the game's imgID
                let imageId = game.gameID;
                let imageLoaded = false;

                // 1. Try with electron
                try {
                  const imageBase64 = await window.electron.getGameImage(game.name);
                  if (imageBase64) {
                    images[game.name] = `data:image/jpeg;base64,${imageBase64}`;
                    imageLoaded = true;
                  }
                } catch (error) {
                  console.warn("Electron image not found for cloud game, trying fallbacks:", error);
                }

                // 2. For local index, try to load from local file system using imgID
                if (!imageLoaded && settings.usingLocalIndex) {
                  try {
                    const gameData = await gameService.findGameByGameID(game.gameID);
                    if (gameData?.imgID) imageId = gameData.imgID;

                    const localImagePath = `${settings.localIndex}/imgs/${imageId}.jpg`;
                    const imageData = await window.electron.ipcRenderer.readFile(localImagePath, "base64");
                    images[game.name] = `data:image/jpeg;base64,${imageData}`;
                    imageLoaded = true;
                  } catch (localError) {
                    console.warn("Could not load from local index:", localError);
                  }
                }

                // 3. Ascendara API
                if (!imageLoaded) {
                  try {
                    const imageUrl = `https://api.ascendara.app/v3/image/${game.gameID}`;
                    const response = await fetch(imageUrl);
                    if (response.ok) {
                      const blob = await response.blob();
                      const dataUrl = await new Promise(resolve => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.readAsDataURL(blob);
                      });
                      images[game.name] = dataUrl;
                    }
                  } catch (error) {
                    console.error("Error loading cloud game image from API:", error);
                  }
                }
              }
            } catch (error) {
              console.error("Error loading cloud game image:", error);
            }
          }
          setCloudGameImages(images);
        }
      } catch (e) {
        console.error("Failed to load cloud library:", e);
      }
      setLoadingCloudGames(false);
    };

    loadCloudOnlyGames();
  }, [user, games]); // Re-run when user changes or games list changes

  // Restore game from cloud - find in local index and start download
  const handleRestoreFromCloud = async cloudGame => {
    // Handle custom games differently - they need to be manually re-added
    if (cloudGame.isCustom) {
      // Store cloud data in localStorage to restore after user manually adds the game
      const cloudRestoreData = {
        gameName: cloudGame.name,
        playTime: cloudGame.playTime,
        launchCount: cloudGame.launchCount,
        lastPlayed: cloudGame.lastPlayed,
        favorite: cloudGame.favorite,
        isCustom: true,
      };
      safeSetItem(
        `cloud-restore-${cloudGame.name}`,
        JSON.stringify(cloudRestoreData)
      );

      // Show info toast and open add game dialog
      toast.info(t("library.cloudRestore.customGameInfo"));
      setIsAddGameOpen(true);
      return;
    }

    if (!cloudGame.gameID) {
      toast.error(t("library.cloudRestore.noGameId"));
      return;
    }

    setRestoringGame(cloudGame.name);
    try {
      // Find the game in the local index using gameID
      const gameData = await gameService.findGameByGameID(cloudGame.gameID);
      if (!gameData) {
        toast.error(t("library.cloudRestore.gameNotFound"));
        setRestoringGame(null);
        return;
      }

      // Store cloud data in localStorage to restore after download completes
      const cloudRestoreData = {
        gameName: cloudGame.name,
        playTime: cloudGame.playTime,
        launchCount: cloudGame.launchCount,
        lastPlayed: cloudGame.lastPlayed,
        favorite: cloudGame.favorite,
      };
      safeSetItem(
        `cloud-restore-${cloudGame.name}`,
        JSON.stringify(cloudRestoreData)
      );

      // Navigate to download page with the game data
      navigate("/download", {
        state: {
          gameData: {
            ...gameData,
            fromCloudRestore: true,
          },
          fromCloudRestore: true,
        },
      });
    } catch (error) {
      console.error("Error restoring game from cloud:", error);
      toast.error(t("library.cloudRestore.error"));
    }
    setRestoringGame(null);
  };

  // Check for pending cloud restores when games are loaded
  // This handles the case where a cloud game was downloaded and we need to restore its data
  const checkPendingCloudRestores = async installedGames => {
    // Get all cloud-restore keys from localStorage
    const keysToCheck = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("cloud-restore-")) {
        keysToCheck.push(key);
      }
    }

    // Sanitize game name to match backend directory naming
    const sanitizeName = (name) => {
      if (!name) return "";
      return name.replace(/[<>:"/\\|?*]/g, "").trim().toLowerCase();
    };

    for (const key of keysToCheck) {
      const gameName = key.replace("cloud-restore-", "");
      // Check if this game is now installed using sanitized name comparison
      const isInstalled = installedGames.some(
        g => sanitizeName(g.game || g.name) === sanitizeName(gameName)
      );

      if (isInstalled) {
        try {
          const cloudRestoreDataStr = localStorage.getItem(key);
          if (cloudRestoreDataStr) {
            const cloudRestoreData = JSON.parse(cloudRestoreDataStr);
            console.log("Restoring cloud data for:", gameName, cloudRestoreData);

            // Restore the cloud data to the game's JSON file
            const result = await window.electron.restoreCloudGameData(
              gameName,
              cloudRestoreData
            );

            // Also restore achievements from cloud if available
            if (user) {
              try {
                const achievementsResult = await getGameAchievements(gameName);
                // Check if we have achievement data (could be in .achievements or directly in .data)
                if (achievementsResult.data) {
                  console.log(
                    "Restoring achievements for:",
                    gameName,
                    achievementsResult.data
                  );
                  await window.electron.writeGameAchievements(
                    gameName,
                    achievementsResult.data
                  );
                }
              } catch (achError) {
                console.error("Error restoring achievements:", achError);
              }
            }

            if (result.success) {
              toast.success(t("library.cloudRestore.restored"));
            } else {
              console.error("Failed to restore cloud data:", result.error);
            }

            // Clean up localStorage
            localStorage.removeItem(key);
          }
        } catch (error) {
          console.error("Error restoring cloud data:", error);
          localStorage.removeItem(key);
        }
      }
    }
  };

  const handleCreateFolder = name => {
    // Create new folder using the folderManager library
    const newFolder = createFolder(name);

    // Add to games list
    setGames(prev => [newFolder, ...prev]);

    // Update folders state
    setFolders(loadFolders());

    setIsNewFolderOpen(false);
  };

  const loadGames = async () => {
    try {
      // Get games from main process
      const installedGames = await window.electron.getGames();
      const customGames = await window.electron.getCustomGames();

      // Ensure we have arrays to work with
      const safeInstalledGames = Array.isArray(installedGames) ? installedGames : [];
      const safeCustomGames = Array.isArray(customGames) ? customGames : [];

      // Check for pending cloud restores (games that were downloaded from cloud)
      await checkPendingCloudRestores([...safeInstalledGames, ...safeCustomGames]);

      // Filter out games that are being verified or downloading
      const filteredInstalledGames = safeInstalledGames.filter(
        game =>
          !game.downloadingData?.verifying &&
          !game.downloadingData?.downloading &&
          !game.downloadingData?.extracting &&
          !game.downloadingData?.updating &&
          !game.downloadingData?.stopped &&
          (!game.downloadingData?.verifyError ||
            game.downloadingData.verifyError.length === 0)
      );

      // Combine both types of games
      const allGames = [
        ...(filteredInstalledGames || []).map(game => ({
          ...game,
          isCustom: false,
        })),
        ...(safeCustomGames || []).map(game => ({
          name: game.game,
          game: game.game, // Keep original property for compatibility
          version: game.version,
          online: game.online,
          dlc: game.dlc,
          isVr: game.isVr,
          executable: game.executable,
          playTime: game.playTime,
          isCustom: true,
          custom: true,
        })),
      ];

      // Load folders using the folderManager library
      const folders = loadFolders();

      // Add folders to the games list
      const foldersAsGames = folders.map(folder => ({
        ...folder,
        isFolder: true,
      }));

      // Filter out games that are in folders using the folderManager library
      const gamesNotInFolders = filterGamesNotInFolders(allGames);

      // Set the folders state
      setFolders(folders);

      // Combine games not in folders with folder items
      setGames([...foldersAsGames, ...gamesNotInFolders]);
      setLoading(false);
    } catch (error) {
      console.error("Error loading games:", error);
      setError("Failed to load games");
      setLoading(false);
    }
  };

  const handleCloudSync = async () => {
    if (!user) {
      navigate("/ascend");
      return;
    }

    setIsSyncingLibrary(true);
    try {
      const installedGames = (await window.electron?.getGames?.()) || [];
      const customGames = (await window.electron?.getCustomGames?.()) || [];

      const allGames = [
        ...(installedGames || []).filter(
          g => !g.downloadingData?.downloading && !g.downloadingData?.extracting
        ),
        ...(customGames || []).map(g => ({ ...g, isCustom: true })),
      ];

      const gamesWithAchievements = await Promise.all(
        allGames.map(async game => {
          try {
            const gameName = game.game || game.name;
            const isCustom = game.isCustom || game.custom || false;

            let achievementData = null;

            if (isCustom && game.achievementWatcher?.achievements) {
              achievementData = game.achievementWatcher;
            } else {
              achievementData = await window.electron?.readGameAchievements?.(
                gameName,
                isCustom
              );
            }

            if (achievementData?.achievements?.length > 0) {
              const totalAchievements = achievementData.achievements.length;
              const unlockedAchievements = achievementData.achievements.filter(
                a => a.achieved
              ).length;

              await syncGameAchievements(gameName, isCustom, achievementData);

              return {
                ...game,
                achievementStats: {
                  total: totalAchievements,
                  unlocked: unlockedAchievements,
                  percentage: Math.round(
                    (unlockedAchievements / totalAchievements) * 100
                  ),
                },
              };
            }
          } catch (e) {
            console.warn(
              `Failed to fetch/sync achievements for ${game.game || game.name}:`,
              e
            );
          }
          return { ...game, achievementStats: null };
        })
      );

      const result = await syncCloudLibrary(gamesWithAchievements);
      if (result.success) {
        toast.success(t("ascend.cloudLibrary.synced") || "Library synced to cloud!");
      } else {
        toast.error(
          result.error || t("ascend.cloudLibrary.syncFailed") || "Failed to sync library"
        );
      }
    } catch (e) {
      console.error("Failed to sync library:", e);
      toast.error(t("ascend.cloudLibrary.syncFailed") || "Failed to sync library");
    }
    setIsSyncingLibrary(false);
  };

  const handlePlayGame = async game => {
    navigate("/gamescreen", {
      state: {
        gameData: game,
        libraryPage: currentPage,
      },
    });
  };

  // Get current library game count
  const getCurrentGameCount = () => {
    return games.filter(g => !g.isFolder).length + getGamesInFolders().length;
  };

  // Check if library has changed since last calculation
  const libraryHasChanged = () => {
    const currentCount = getCurrentGameCount();
    return currentCount !== cachedGameCount;
  };

  const handleCalculateLibraryValue = async (forceRecalculate = false) => {
    setIsLibraryValueOpen(true);

    // If we have cached data and library hasn't changed, just show it
    if (!forceRecalculate && libraryValueData && !libraryHasChanged()) {
      return;
    }

    setIsCalculatingValue(true);
    setValueProgress({ current: 0, total: 0, game: "" });

    try {
      // Get all game titles from library (including games in folders)
      const allGameTitles = [
        ...games.filter(g => !g.isFolder).map(g => g.game || g.name),
        ...getGamesInFolders().map(g => g.game || g.name),
      ];

      if (allGameTitles.length === 0) {
        const emptyResult = { totalValue: 0, games: [], notFound: [] };
        setLibraryValueData(emptyResult);
        safeSetItem("library-value-cache", JSON.stringify(emptyResult));
        safeSetItem("library-value-game-count", "0");
        setCachedGameCount(0);
        setIsCalculatingValue(false);
        return;
      }

      setValueProgress({ current: 0, total: allGameTitles.length, game: "" });

      const result = await calculateLibraryValue(
        allGameTitles,
        (current, total, game, price) => {
          setValueProgress({ current, total, game });
        }
      );

      // Cache the result
      setLibraryValueData(result);
      safeSetItem("library-value-cache", JSON.stringify(result));
      safeSetItem("library-value-game-count", String(allGameTitles.length));
      setCachedGameCount(allGameTitles.length);
    } catch (error) {
      console.error("Error calculating library value:", error);
      toast.error(t("library.libraryValue.error") || "Failed to calculate library value");
    }
    setIsCalculatingValue(false);
  };

  const searchGameCovers = React.useCallback(async query => {
    if (!query.trim()) {
      setCoverSearchResults([]);
      return;
    }

    setIsCoverSearchLoading(true);
    try {
      const gameDetails = await steamService.getGameDetails(query);
      // Transform the results to match the expected format
      const results = gameDetails
        .map(game => ({
          id: game.id,
          url:
            game.screenshots && game.screenshots.length > 0
              ? steamService.formatImageUrl(game.screenshots[0].url, "screenshot_big")
              : null,
          name: game.name,
        }))
        .filter(game => game.url); // Only include games with screenshots
      setCoverSearchResults(results);
    } catch (error) {
      console.error("Error searching game covers:", error);
      setCoverSearchResults([]);
    } finally {
      setIsCoverSearchLoading(false);
    }
  }, []);

  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      searchGameCovers(coverSearchQuery);
    }, 300);
    return () => clearTimeout(debounceTimer);
  }, [coverSearchQuery, searchGameCovers]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <div className="space-y-1">
            <h3 className="text-xl font-semibold tracking-tight">{t("library.loadingLibrary")}</h3>
            <p className="text-sm text-muted-foreground">{t("library.loadingLibraryMessage")}</p>
          </div>
        </div>
      </div>
    );
  }

  const tabGames = activeTab === "favorites"
    ? filteredGames.filter(g => !g.isFolder && favorites.includes(g.game || g.name))
    : filteredGames;

  const tabTotalPages = Math.ceil(tabGames.length / PAGE_SIZE);
  const tabPaginatedGames = tabGames.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const sidebarTabs = [
    {
      id: "all",
      label: t("library.pageTitle") || "Library",
      icon: <SquareLibrary className="h-4 w-4" />,
      count: games.filter(g => !g.isFolder).length + getGamesInFolders().length,
    },
    {
      id: "favorites",
      label: t("library.filters.favorites.label") || "Favorites",
      icon: <Heart className="h-4 w-4" />,
      count: favorites.length,
    },
    {
      id: "cloud",
      label: t("library.cloudOnly.title") || "Cloud Library",
      icon: <Cloud className="h-4 w-4" />,
      count: cloudOnlyGames.length,
      hidden: !user,
    },
    {
      id: "playLater",
      label: t("library.playLater.title") || "Play Later",
      icon: <Clock className="h-4 w-4" />,
      count: playLaterGames.length,
    },
  ].filter(tab => !tab.hidden);

  return (
    <div className="fixed inset-0 top-[60px] flex overflow-hidden bg-background">
      {/* ── Left Sidebar ─────────────────────────────────────────── */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-border/30 shadow-[1px_0_0_0_hsl(var(--border)/0.15)]">

        {/* ── User profile strip ── */}
        <div className="bg-muted/30 rounded-none">
          <div className="flex items-center gap-3 px-4 pb-3 pt-3">
            <button
              className="flex min-w-0 flex-1 items-center gap-3 rounded-lg transition-colors hover:opacity-80"
              onClick={() => navigate("/profile")}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 ring-1 ring-primary/30">
                {userData?.photoURL
                  ? <img src={userData.photoURL} className="h-8 w-8 rounded-full object-cover" alt="" />
                  : <User className="h-3.5 w-3.5 text-primary" />
                }
              </div>
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-semibold leading-none text-foreground">{username || "Guest"}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {games.filter(g => !g.isFolder).length + getGamesInFolders().length}{" "}
                  {t("library.gamesInLibrary") || "games"}
                </p>
              </div>
            </button>
            {ascendAccess.hasAccess && (
              <button
                title={showAscendPanel ? "Hide Ascend" : "Show Ascend"}
                onClick={async () => {
                  const next = !showAscendPanel;
                  setShowAscendPanel(next);
                  if (next && !friendsLoaded) {
                    const { friends: list } = await getFriendsList();
                    setFriends(list || []);
                    setFriendsLoaded(true);
                  }
                }}
                className={cn(
                  "shrink-0 rounded-md p-1.5 transition-colors",
                  showAscendPanel
                    ? "bg-primary/15 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Sparkles className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* ── Ascend panel ── */}
          {showAscendPanel && ascendAccess.hasAccess && (() => {
            const stats = userData?.profileStats;
            const level = stats?.level ?? 1;
            const xp = stats?.xp ?? 0;
            const nextXP = level * 500;
            const pct = Math.min(100, Math.round((xp / nextXP) * 100));
            const onlineFriends = friends.filter(f => f.status === "online" || f.status === "busy");
            return (
              <div className="px-4 pb-3 pt-1">
                {/* Level + XP */}
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-primary">Level {level}</span>
                  <span className="text-[10px] text-muted-foreground">{xp} / {nextXP} XP</span>
                </div>
                <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                </div>

                {/* Online friends */}
                {friends.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                      Friends {onlineFriends.length > 0 && <span className="text-primary">· {onlineFriends.length} online</span>}
                    </p>
                    <div className="space-y-1">
                      {friends.slice(0, 5).map(friend => (
                        <div key={friend.uid} className="flex items-center gap-2">
                          <div className="relative shrink-0">
                            {friend.photoURL
                              ? <img src={friend.photoURL} className="h-5 w-5 rounded-full object-cover" alt="" />
                              : <div className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground">
                                  {friend.displayName?.[0]?.toUpperCase()}
                                </div>
                            }
                            <span className={cn(
                              "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-1 ring-background",
                              friend.status === "online" ? "bg-green-500"
                              : friend.status === "busy" ? "bg-yellow-500"
                              : "bg-muted-foreground/40"
                            )} />
                          </div>
                          <span className="truncate text-[11px] text-foreground/80">{friend.displayName}</span>
                        </div>
                      ))}
                      {friends.length > 5 && (
                        <p className="text-[10px] text-muted-foreground">+{friends.length - 5} more</p>
                      )}
                    </div>
                  </div>
                )}
                {friends.length === 0 && friendsLoaded && (
                  <p className="text-[11px] text-muted-foreground">No friends yet</p>
                )}
              </div>
            );
          })()}
        </div>

        {/* ── Library views ── */}
        <nav className="space-y-0.5 px-2 pt-3">
          <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Library</p>
          {sidebarTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setCurrentPage(1); }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-all",
                activeTab === tab.id
                  ? "bg-primary/10 font-semibold text-primary"
                  : "font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              )}
            >
              <span className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
                activeTab === tab.id ? "bg-primary/15 text-primary" : "text-muted-foreground"
              )}>
                {tab.icon}
              </span>
              <span className="flex-1 text-left">{tab.label}</span>
              {tab.count > 0 && (
                <span className={cn(
                  "min-w-[1.25rem] rounded px-1 py-0.5 text-center text-[10px] font-bold tabular-nums",
                  activeTab === tab.id
                    ? "bg-primary/20 text-primary"
                    : "bg-muted/80 text-muted-foreground"
                )}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* ── Actions ── */}
        <div className="space-y-0.5 px-2 pt-3">
          <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Manage</p>

          <TooltipProvider>
            <AlertDialog key="add-game-dialog" open={isAddGameOpen} onOpenChange={setIsAddGameOpen}>
              <AlertDialogTrigger asChild>
                <button className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-all hover:bg-accent/60 hover:text-foreground">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground">
                    <Plus className="h-4 w-4" />
                  </span>
                  <span>{t("library.addGame.title") || "Add Game"}</span>
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent className="border-border bg-background sm:max-w-[425px]">
                <AlertDialogHeader className="space-y-2">
                  <AlertDialogTitle className="text-2xl font-bold text-foreground">
                    {t("library.addGame.title")}
                  </AlertDialogTitle>
                  <AlertDialogDescription className="text-xs text-muted-foreground">
                    {t("library.addGameDescription2")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="max-h-[60vh] overflow-y-auto py-4">
                  <AddGameForm
                    onSuccess={() => {
                      setIsAddGameOpen(false);
                      setSelectedGameImage(null);
                      loadGames();
                    }}
                  />
                </div>
              </AlertDialogContent>
            </AlertDialog>

            <button
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-all hover:bg-accent/60 hover:text-foreground"
              onClick={() => setIsNewFolderOpen(true)}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground">
                <FolderPlus className="h-4 w-4" />
              </span>
              <span>{t("library.newFolder.create") || "New Folder"}</span>
            </button>
            <NewFolderDialog open={isNewFolderOpen} onOpenChange={setIsNewFolderOpen} onCreate={handleCreateFolder} />

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-all hover:bg-accent/60 hover:text-foreground",
                    isSyncingLibrary && "cursor-not-allowed opacity-50"
                  )}
                  onClick={handleCloudSync}
                  disabled={isSyncingLibrary}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground">
                    {isSyncingLibrary ? <Loader className="h-4 w-4 animate-spin" /> : <CloudUpload className="h-4 w-4" />}
                  </span>
                  <span>{t("library.cloudSync") || "Sync to Cloud"}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-secondary">
                {user ? t("library.cloudSync") || "Sync to Cloud" : t("library.signInToSync") || "Sign in to sync"}
              </TooltipContent>
            </Tooltip>

            <button
              onClick={() => handleCalculateLibraryValue()}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground transition-all hover:bg-accent/60 hover:text-foreground"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground">
                <DollarSign className="h-4 w-4" />
              </span>
              <span className="truncate">
                {libraryValueData && !libraryHasChanged()
                  ? `$${libraryValueData.totalValue.toFixed(2)}`
                  : t("library.libraryValue.calculate") || "Library Value"}
              </span>
            </button>
          </TooltipProvider>
        </div>

        {/* ── Spacer pushes storage to bottom ── */}
        <div className="flex-1" />

        {/* ── Storage info ── */}
        <div className="px-4 pb-4 pt-2">
          <div className="rounded-lg bg-muted/30 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <HardDrive className="h-3 w-3" />
                <span className="font-medium">{t("library.availableSpace") || "Available"}</span>
              </div>
              <span className="text-xs font-semibold text-foreground">
                {storageInfo ? formatBytes(storageInfo.freeSpace) : <Loader className="h-3 w-3 animate-spin" />}
              </span>
            </div>
            {storageInfo && (
              <>
                <div className="relative h-1 overflow-hidden rounded-full bg-muted/50">
                  <div
                    className="absolute left-0 top-0 h-full rounded-full bg-primary"
                    style={{ width: `${Math.min((totalGamesSize / storageInfo.totalSpace) * 100, 100)}%`, zIndex: 2 }}
                  />
                  <div
                    className="absolute left-0 top-0 h-full rounded-full bg-muted-foreground/30"
                    style={{ width: `${Math.min(((storageInfo.totalSpace - storageInfo.freeSpace) / storageInfo.totalSpace) * 100, 100)}%`, zIndex: 1 }}
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{isCalculatingSize ? "…" : formatBytes(totalGamesSize)} games</span>
                  <span>{formatBytes(storageInfo.totalSpace)}</span>
                </div>

                {/* Multiple directories breakdown */}
                {storageInfo.directories && storageInfo.directories.length > 1 && (
                  <>
                    <button
                      onClick={() => setShowStorageDetails(prev => !prev)}
                      className="mt-1 flex w-full items-center justify-center gap-1 rounded-md py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                    >
                      {showStorageDetails ? "Hide details" : "Show details"}
                      <svg
                        className={cn("h-3 w-3 transition-transform", showStorageDetails && "rotate-180")}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                      </svg>
                    </button>

                    {showStorageDetails && (
                      <div className="mt-2 space-y-2 border-t border-border/40 pt-2">
                        {storageInfo.directories.map((dir, idx) => {
                          const usedPct = Math.min((dir.usedSpace / dir.totalSpace) * 100, 100);
                          const gamesPct = Math.min(((dir.gamesSize || 0) / dir.totalSpace) * 100, 100);
                          const label = dir.path.split(/[\\/]/).pop() || dir.path;
                          return (
                            <div key={dir.path || idx} className="space-y-1">
                              <div className="flex items-center justify-between text-[10px]">
                                <span className="max-w-[7rem] truncate font-medium text-foreground/80" title={dir.path}>
                                  {label}
                                </span>
                                <span className="text-muted-foreground">
                                  {formatBytes(dir.freeSpace)} free
                                </span>
                              </div>
                              <div className="relative h-1 overflow-hidden rounded-full bg-muted/50">
                                <div
                                  className="absolute left-0 top-0 h-full rounded-full bg-primary/70"
                                  style={{ width: `${gamesPct}%`, zIndex: 2 }}
                                  title={`Games: ${formatBytes(dir.gamesSize || 0)}`}
                                />
                                <div
                                  className="absolute left-0 top-0 h-full rounded-full bg-muted-foreground/20"
                                  style={{ width: `${usedPct}%`, zIndex: 1 }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main Content ─────────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Sticky toolbar */}
        <div className="flex shrink-0 items-center gap-3 bg-background/95 px-6 py-3 backdrop-blur-sm shadow-[0_1px_0_0_hsl(var(--border)/0.4)]">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t("library.searchLibrary")}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="h-9 pl-9"
            />
          </div>

          <TooltipProvider>
            <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
              <DropdownMenuTrigger asChild>
                <button className="rounded-md p-2 hover:bg-secondary/50" type="button">
                  <SortAscIcon className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={() => { setSortOrder("asc"); setSortMode("alpha"); }} className={cn("cursor-pointer", sortMode === "alpha" && sortOrder === "asc" && "bg-accent/50")}>
                  <ArrowUpAZ className="mr-2 h-4 w-4" />
                  {t("library.sort.aToZ")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setSortOrder("desc"); setSortMode("alpha"); }} className={cn("cursor-pointer", sortMode === "alpha" && sortOrder === "desc" && "bg-accent/50")}>
                  <ArrowDownAZ className="mr-2 h-4 w-4" />
                  {t("library.sort.zToA")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortMode("playtime")} className={cn("cursor-pointer", sortMode === "playtime" && "bg-accent/50")}>
                  <Timer className="mr-2 h-4 w-4" />
                  {t("library.sort.mostPlayed")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">{t("library.sort.groupBy")}</p>
                <DropdownMenuItem onClick={() => setGroupBy("none")} className={cn("cursor-pointer", groupBy === "none" && "bg-accent/50")}>
                  <SquareLibrary className="mr-2 h-4 w-4" />
                  {t("library.sort.groupNone")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setGroupBy("directory")} className={cn("cursor-pointer", groupBy === "directory" && "bg-accent/50")}>
                  <HardDriveDownload className="mr-2 h-4 w-4" />
                  {t("library.sort.groupByDirectory")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem className="cursor-pointer" checked={filters.vrOnly} onCheckedChange={checked => setFilters(prev => ({ ...prev, vrOnly: checked }))}>
                  <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M2 10C2 8.89543 2.89543 8 4 8H20C21.1046 8 22 8.89543 22 10V17C22 18.1046 21.1046 19 20 19H16.1324C15.4299 19 14.7788 18.6314 14.4174 18.029L12.8575 15.4292C12.4691 14.7818 11.5309 14.7818 11.1425 15.4292L9.58261 18.029C9.22116 18.6314 8.57014 19 7.86762 19H4C2.89543 19 2 18.1046 2 17V10Z" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M3.81253 6.7812C4.5544 5.6684 5.80332 5 7.14074 5H16.8593C18.1967 5 19.4456 5.6684 20.1875 6.7812L21 8H3L3.81253 6.7812Z" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {t("library.filters.vrGames")}
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem className="cursor-pointer" checked={filters.onlineGames} onCheckedChange={checked => setFilters(prev => ({ ...prev, onlineGames: checked }))}>
                  <Gamepad2 className="mr-2 h-4 w-4" />
                  {t("library.filters.onlineGames")}
                </DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={cn("rounded-md p-2 hover:bg-secondary/50", selectionMode && "bg-primary/10 text-primary")}
                  type="button"
                  onClick={() => { setSelectionMode(prev => !prev); setSelectedGames([]); }}
                >
                  <CheckSquareIcon className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="text-secondary">{t("library.multiselect")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          {selectionMode && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-primary">
                {t("library.tools.selected", { count: selectedGames.length })}
              </span>
              <Button variant="destructive" size="sm" disabled={selectedGames.length === 0} onClick={handleBulkRemove}>
                {t("library.tools.bulkRemove")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setSelectionMode(false); setSelectedGames([]); }}>
                {t("common.cancel")}
              </Button>
            </div>
          )}

          {error && (
            <div className="text-sm text-destructive">{error}</div>
          )}
        </div>

        {/* Scrollable game grid */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* ── All Games / Favorites tab ── */}
          {(activeTab === "all" || activeTab === "favorites") && (() => {
            const renderGameCard = game => (
              <div key={game.game || game.name}>
                {game.isFolder ? (
                  <DroppableFolderCard
                    folder={game}
                    onDropGame={droppedGame => {
                      addGameToFolder(droppedGame, game.game);
                      const updatedFolders = loadFolders();
                      const updatedFolder = updatedFolders.find(f => f.game === game.game);
                      setFolders(updatedFolders);
                      setGames(prevGames =>
                        prevGames
                          .map(g => {
                            if (g.isFolder && g.game === game.game) return { ...updatedFolder };
                            return g;
                          })
                          .filter(g =>
                            (g.game || g.name) !== (droppedGame.game || droppedGame.name) ||
                            (g.isFolder && g.game === game.game)
                          )
                      );
                    }}
                  >
                    <FolderCard
                      key={game.game + "-" + (game.items ? game.items.length : 0)}
                      name={game.game || game.name}
                      folder={game}
                      refreshKey={game.items ? game.items.length : 0}
                    />
                  </DroppableFolderCard>
                ) : (
                  <DraggableGameCard game={game}>
                    <InstalledGameCard
                      game={game}
                      onPlay={() => selectionMode ? handleSelectGame(game) : handlePlayGame(game)}
                      favorites={favorites}
                      onToggleFavorite={() => toggleFavorite(game.game || game.name)}
                      selectionMode={selectionMode}
                      isSelected={selectedGames.includes(game.game)}
                      onSelectCheckbox={() => handleSelectGame(game)}
                      updateInfo={game.gameID ? gameUpdates[game.gameID] : null}
                    />
                  </DraggableGameCard>
                )}
              </div>
            );

            const gridClass = "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6";

            if (groupBy === "directory") {
              // Build directory groups from all filtered games (not paginated) so each section is complete
              const dirGroups = new Map();
              tabGames.forEach(game => {
                const dir = game._sourceDir || t("library.sort.addedGames");
                if (!dirGroups.has(dir)) dirGroups.set(dir, []);
                dirGroups.get(dir).push(game);
              });

              return (
                <DndProvider backend={HTML5Backend}>
                  {dirGroups.size === 0 && (
                    <div className="flex flex-col items-center justify-center py-24 text-center">
                      <SquareLibrary className="mb-4 h-12 w-12 text-muted-foreground/30" />
                      <p className="text-sm text-muted-foreground">{t("library.noGamesFound")}</p>
                    </div>
                  )}
                  {[...dirGroups.entries()].map(([dir, dirGames]) => {
                    const label = dir.split(/[\\/]/).pop() || dir;
                    return (
                      <div key={dir} className="mb-8">
                        <div className="mb-3 flex items-center gap-2">
                          <HardDriveDownload className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/70" title={dir}>{label}</span>
                          <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">{dirGames.length}</span>
                          <div className="ml-1 flex-1 border-t border-border/30" />
                        </div>
                        <div className={gridClass}>
                          {dirGames.sort((a, b) => (a.isFolder === b.isFolder ? 0 : a.isFolder ? -1 : 1)).map(renderGameCard)}
                        </div>
                      </div>
                    );
                  })}
                </DndProvider>
              );
            }

            return (
              <>
                <DndProvider backend={HTML5Backend}>
                  <div className={gridClass}>
                    {tabPaginatedGames
                      .sort((a, b) => (a.isFolder === b.isFolder ? 0 : a.isFolder ? -1 : 1))
                      .map(renderGameCard)}
                  </div>
                </DndProvider>

                {tabPaginatedGames.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-24 text-center">
                    <SquareLibrary className="mb-4 h-12 w-12 text-muted-foreground/30" />
                    <p className="text-sm text-muted-foreground">
                      {activeTab === "favorites" ? (t("library.filters.favorites.empty")) : t("library.noGamesFound") || "No games found"}
                    </p>
                  </div>
                )}

                {tabTotalPages > 1 && (
                  <div className="mt-6 flex items-center justify-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}>
                      {t("common.prev")}
                    </Button>
                    <span className="px-3 text-sm text-muted-foreground">
                      {t("common.page")} {currentPage} / {tabTotalPages}
                    </span>
                    <Button variant="outline" size="sm" onClick={() => setCurrentPage(p => Math.min(tabTotalPages, p + 1))} disabled={currentPage === tabTotalPages}>
                      {t("common.next")}
                    </Button>
                  </div>
                )}
              </>
            );
          })()}

          {/* ── Cloud Library tab ── */}
          {activeTab === "cloud" && (
            <>
              {loadingCloudGames ? (
                <div className="flex items-center justify-center py-24">
                  <Loader className="h-8 w-8 animate-spin text-primary" />
                </div>
              ) : cloudOnlyGames.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <Cloud className="mb-4 h-12 w-12 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">{t("library.cloudOnly.empty") || "No cloud-only games"}</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {cloudOnlyGames.map(game => (
                    <CloudOnlyGameCard
                      key={game.name}
                      game={game}
                      imageData={cloudGameImages[game.name]}
                      onRestore={() => handleRestoreFromCloud(game)}
                      isRestoring={restoringGame === game.name}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Play Later tab ── */}
          {activeTab === "playLater" && (
            <>
              {playLaterGames.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <Clock className="mb-4 h-12 w-12 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">{t("library.playLater.empty") || "No games in Play Later"}</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                  {playLaterGames.map(game => (
                    <PlayLaterGameCard
                      key={game.game}
                      game={game}
                      onDownload={() => handleDownloadPlayLater(game)}
                      onRemove={() => handleRemoveFromPlayLater(game.game)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Library Value Dialog */}
      <AlertDialog open={isLibraryValueOpen} onOpenChange={setIsLibraryValueOpen}>
        <AlertDialogContent className="flex max-h-[80vh] max-w-lg flex-col overflow-hidden">
          <AlertDialogHeader className="shrink-0">
            <AlertDialogTitle className="flex items-center gap-2">
              {t("library.libraryValue.title") || "Library Value"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("library.libraryValue.description1")}&nbsp;
              <a
                className="cursor-pointer text-primary hover:underline"
                onClick={() => window.electron.openURL("https://apidocs.cheapshark.com/")}
              >
                {t("library.libraryValue.description2")}{" "}
                <ExternalLink className="mb-1 inline-block h-3 w-3" />
              </a>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex-1 overflow-y-auto py-4">
            {/* Ascend Promo for non-subscribers */}
            {!user && libraryValueData?.totalValue > 0 && (
              <div className="mb-4 rounded-lg border border-primary/30 bg-gradient-to-r from-primary/5 to-primary/10 p-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-full bg-primary/20 p-2">
                    <Clock className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-primary">
                      {t("library.libraryValue.ascendPromo.title") ||
                        "You've saved a fortune!"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("library.libraryValue.ascendPromo.message", {
                        months: Math.floor(
                          libraryValueData.totalValue / 2
                        ).toLocaleString(),
                        years: Math.floor(
                          libraryValueData.totalValue / 2 / 12
                        ).toLocaleString(),
                      })}
                    </p>
                    <Button
                      variant="link"
                      size="sm"
                      className="mt-2 h-auto p-0 text-xs text-primary"
                      onClick={() => {
                        setIsLibraryValueOpen(false);
                        navigate("/ascend");
                      }}
                    >
                      {t("library.libraryValue.ascendPromo.cta") || "Learn about Ascend"}{" "}
                      →
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {isCalculatingValue ? (
              <div className="flex flex-col items-center justify-center space-y-4 py-8">
                <Loader className="h-8 w-8 animate-spin text-primary" />
                <div className="text-center">
                  <p className="text-sm font-medium">
                    {t("library.libraryValue.calculating") || "Calculating..."}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {valueProgress.current} / {valueProgress.total}
                  </p>
                  {valueProgress.game && (
                    <p className="mt-1 max-w-[300px] truncate text-xs text-muted-foreground">
                      {valueProgress.game}
                    </p>
                  )}
                </div>
                <div className="w-full max-w-xs">
                  <div className="h-2 w-full rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-primary transition-all duration-300"
                      style={{
                        width: `${valueProgress.total > 0 ? (valueProgress.current / valueProgress.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            ) : libraryValueData ? (
              <div className="space-y-4">
                {/* Total Value */}
                <div className="rounded-lg bg-primary/10 p-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    {t("library.libraryValue.totalValue") || "Total Library Value"}
                  </p>
                  <p className="text-3xl font-bold text-primary">
                    ${libraryValueData.totalValue.toFixed(2)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("library.libraryValue.gamesFound", {
                      count: libraryValueData.games.length,
                    }) || `${libraryValueData.games.length} games found`}
                  </p>
                </div>

                {/* Games List */}
                {libraryValueData.games.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-primary">
                      {t("library.libraryValue.breakdown") || "Price Breakdown"}
                    </p>
                    <div className="max-h-[200px] space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                      {libraryValueData.games
                        .sort((a, b) => b.price - a.price)
                        .map((game, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-muted/50"
                          >
                            <span
                              className="truncate pr-2 text-primary"
                              title={game.title}
                            >
                              {game.title}
                            </span>
                            <span className="shrink-0 font-medium text-primary">
                              ${game.price.toFixed(2)}
                            </span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Not Found Games */}
                {libraryValueData.notFound.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">
                      {t("library.libraryValue.notFound", {
                        count: libraryValueData.notFound.length,
                      }) || `${libraryValueData.notFound.length} games not found`}
                    </p>
                    <div className="max-h-[100px] space-y-1 overflow-y-auto rounded-lg border border-border/50 p-2">
                      {libraryValueData.notFound.map((game, index) => (
                        <div
                          key={index}
                          className="truncate px-2 py-1 text-xs text-muted-foreground"
                          title={game}
                        >
                          {game}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <AlertDialogFooter className="flex justify-between sm:justify-between">
            {libraryValueData && !isCalculatingValue && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCalculateLibraryValue(true)}
                className="mr-auto text-primary"
              >
                {t("library.libraryValue.recalculate") || "Recalculate"}
              </Button>
            )}
            <AlertDialogCancel>{t("common.close") || "Close"}</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Library Redesign Welcome Dialog ── */}
      <AlertDialog open={showRedesignDialog} onOpenChange={setShowRedesignDialog}>
        <AlertDialogContent className="border-border sm:max-w-[460px]">
          <AlertDialogHeader>
            <div className="mb-1 flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15">
                <SquareLibrary className="h-5 w-5 text-primary" />
              </div>
              <AlertDialogTitle className="text-xl font-bold text-foreground">
                {t("library.redesignWelcome.title")}
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription asChild>
              <div className="space-y-3 pt-1">
                <p className="text-sm text-muted-foreground">
                  {t("library.redesignWelcome.subtitle")}
                </p>
                <div className="space-y-2 rounded-lg bg-muted/40 p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 text-primary">✦</span>
                    <span className="text-foreground/80"><span className="font-medium text-foreground">{t("library.redesignWelcome.feature1Title")}</span> — {t("library.redesignWelcome.feature1Desc")}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 text-primary">✦</span>
                    <span className="text-foreground/80"><span className="font-medium text-foreground">{t("library.redesignWelcome.feature2Title")}</span> — {t("library.redesignWelcome.feature2Desc")}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 text-primary">✦</span>
                    <span className="text-foreground/80"><span className="font-medium text-foreground">{t("library.redesignWelcome.feature3Title")}</span> — {t("library.redesignWelcome.feature3Desc")}</span>
                  </div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                localStorage.setItem("library-redesign-welcome-shown", "true");
                setShowRedesignDialog(false);
              }}
            >
              {t("library.redesignWelcome.cta")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const AddGameCard = React.forwardRef((props, ref) => {
  const { t } = useLanguage();
  return (
    <Card
      ref={ref}
      className={cn(
        "group relative overflow-hidden transition-colors",
        "cursor-pointer border-2 border-dashed border-muted hover:border-primary"
      )}
      {...props}
    >
      <CardContent className="flex h-full min-h-[240px] flex-col items-center justify-center p-6 text-muted-foreground group-hover:text-primary">
        <div className="rounded-full bg-muted p-6 group-hover:bg-primary/10">
          <Plus className="h-8 w-8" />
        </div>
        <h3 className="mt-4 text-lg font-semibold">{t("library.addGame.title")}</h3>
        <p className="mt-2 text-center text-sm">{t("library.addGameDescription1")}</p>
      </CardContent>
    </Card>
  );
});

AddGameCard.displayName = "AddGameCard";

const InstalledGameCard = memo(
  ({
    game,
    onPlay,
    isSelected,
    favorites,
    onToggleFavorite,
    selectionMode,
    onSelectCheckbox,
    updateInfo,
  }) => {
    const { t } = useLanguage();
    const { settings } = useSettings();
    const navigate = useNavigate();
    const [isRunning, setIsRunning] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [imageData, setImageData] = useState(() => gameImageCache.get(game.game || game.name) ?? null);
    const [executableExists, setExecutableExists] = useState(null);
    const [contextMenuOpen, setContextMenuOpen] = useState(false);
    const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
    const [logoData, setLogoData] = useState(null);
    const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
    const [isUninstalling, setIsUninstalling] = useState(false);
    const [isReportOpen, setIsReportOpen] = useState(false);
    const isFavorite = favorites.includes(game.game || game.name);

    useEffect(() => {
      const checkExecutable = async () => {
        if (game.executable && !game.isCustom) {
          try {
            const execPath = `${game.game}/${game.executable}`;
            const exists = await window.electron.checkFileExists(execPath);
            setExecutableExists(exists);
          } catch (error) {
            console.error("Error checking executable:", error);
            setExecutableExists(false);
          }
        }
      };

      checkExecutable();
    }, [game.executable, game.isCustom, game.game]);

    // Check game running status periodically
    useEffect(() => {
      let isMounted = true;
      const gameId = game.game || game.name;

      const checkGameStatus = async () => {
        try {
          if (!isMounted) return;
          const running = await window.electron.isGameRunning(gameId);
          if (isMounted) {
            setIsRunning(running);
          }
        } catch (error) {
          console.error("Error checking game status:", error);
        }
      };

      // Initial check
      checkGameStatus();

      // Set up interval for periodic checks - reduced frequency to 3 seconds
      const interval = setInterval(checkGameStatus, 3000);

      // Cleanup function
      return () => {
        isMounted = false;
        clearInterval(interval);
      };
    }, [game.game, game.name]); // Only depend on game ID properties

    // Load game image via IPC (no localStorage caching - data URLs blow out
    // the per-origin localStorage quota; IPC reads from disk are fast).
    // Module-level gameImageCache keeps images in memory across page switches.
    useEffect(() => {
      let isMounted = true;
      const gameId = game.game || game.name;

      const loadGameImage = async () => {
        // Already cached from a previous mount — no IPC call needed
        if (gameImageCache.has(gameId)) return;

        try {
          // Prefer portrait grid image (600x900) for the 2:3 card layout
          const imageBase64 = await window.electron.getGameImage(gameId, "grid");
          if (imageBase64 && isMounted) {
            const dataUrl = `data:image/jpeg;base64,${imageBase64}`;
            gameImageCache.set(gameId, dataUrl);
            setImageData(dataUrl);
            return;
          }
        } catch (error) {
          console.error("Error loading game image:", error);
        }
        // No image found on disk — attempt to repair (re-download) it
        if (!game.isCustom && isMounted) {
          try {
            const repairedBase64 = await window.electron.repairGameImage(gameId);
            if (repairedBase64 && isMounted) {
              const dataUrl = `data:image/jpeg;base64,${repairedBase64}`;
              gameImageCache.set(gameId, dataUrl);
              setImageData(dataUrl);
            }
          } catch (e) {
            console.warn("Could not repair game image:", e);
          }
        }
      };

      // Listen for game cover update events
      const handleCoverUpdate = event => {
        const { gameName, dataUrl } = event.detail;
        if (gameName === gameId && dataUrl && isMounted) {
          console.log(`Received cover update for ${gameName}`);
          gameImageCache.set(gameId, dataUrl);
          setImageData(dataUrl);
        }
      };

      // Add event listener for cover updates
      window.addEventListener("game-cover-updated", handleCoverUpdate);

      // Initial load
      loadGameImage();

      return () => {
        isMounted = false;
        // Clean up event listener
        window.removeEventListener("game-cover-updated", handleCoverUpdate);
      };
    }, [game.game, game.name]); // Only depend on game ID properties

    // Dialog state for editing cover
    const [showEditCoverDialog, setShowEditCoverDialog] = useState(false);
    const minSearchLength = 3;
    const [coverSearch, setCoverSearch] = useState({
      query: "",
      isLoading: false,
      results: [],
      selectedCover: null,
    });
    const [coverImageUrls, setCoverImageUrls] = useState({});

    // Load game logo
    useEffect(() => {
      let isMounted = true;
      const gameId = game.game || game.name;

      const loadLogo = async () => {
        try {
          const logoBase64 = await window.electron.ipcRenderer.invoke(
            "get-game-image",
            gameId,
            "logo"
          );
          if (logoBase64 && isMounted) {
            setLogoData(`data:image/png;base64,${logoBase64}`);
          } else {
            setLogoData(null);
          }
        } catch (e) {
          setLogoData(null);
        }
      };

      loadLogo();

      return () => {
        isMounted = false;
      };
    }, [game.game, game.name]);

    const handleContextMenu = e => {
      e.preventDefault();
      e.stopPropagation();
      
      const x = e.clientX;
      const y = e.clientY;
      const menuWidth = 260; // min-w-[260px] from the menu
      const menuHeight = 250; // More realistic estimate based on typical menu size
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = x;
      let adjustedY = y;

      // Check if menu would go off right side
      if (x + menuWidth > viewportWidth) {
        adjustedX = Math.max(0, viewportWidth - menuWidth);
      }

      // Check if menu would go off bottom of screen
      if (y + menuHeight > viewportHeight) {
        // Open upward instead
        adjustedY = y - menuHeight;
      }

      // Ensure it doesn't go off top
      if (adjustedY < 0) {
        adjustedY = Math.max(0, Math.min(y, viewportHeight - menuHeight));
      }
      
      setContextMenuPosition({ x: adjustedX, y: adjustedY });
      setContextMenuOpen(true);
    };

    const handlePlayFromContext = async e => {
      e.stopPropagation();
      setContextMenuOpen(false);
      
      if (!game.executable && !game.isCustom) {
        toast.error(t("library.noExecutableSet"));
        return;
      }
      
      navigate("/gamescreen", {
        state: {
          gameData: game,
        },
      });
    };

    const handleRemoveGame = e => {
      e.stopPropagation();
      setContextMenuOpen(false);
      setIsDeleteDialogOpen(true);
    };

    const handleDeleteGame = e => {
      e.stopPropagation();
      setContextMenuOpen(false);
      setIsDeleteDialogOpen(true);
    };

    const confirmDeleteGame = async () => {
      try {
        setIsUninstalling(true);
        const gameId = game.game || game.name;

        if (game.isCustom) {
          await window.electron.removeCustomGame(gameId);
        } else {
          await window.electron.deleteGame(gameId);
        }

        setIsUninstalling(false);
        setIsDeleteDialogOpen(false);
        window.location.reload();
      } catch (error) {
        console.error("Error deleting game:", error);
        setIsUninstalling(false);
      }
    };

    const handleOpenDirectory = async e => {
      e.stopPropagation();
      setContextMenuOpen(false);
      
      try {
        await window.electron.openGameDirectory(game.game || game.name);
      } catch (error) {
        console.error("Failed to open directory:", error);
        toast.error(t("library.failedToOpenDirectory"));
      }
    };

    const handleCoverSearch = async query => {
      setCoverSearch(prev => ({
        ...prev,
        query,
        isLoading: true,
        results: [],
        selectedCover: null,
      }));
      if (query.length < minSearchLength) {
        setCoverSearch(prev => ({ ...prev, isLoading: false, results: [] }));
        setCoverImageUrls({});
        return;
      }
      try {
        // Use SteamGridDB for proper grid covers (600x900 portrait)
        const searchUrl = `https://api.ascendara.app/api/proxy/steamgrid/search/autocomplete/${encodeURIComponent(query)}`;
        const searchResponse = await fetch(searchUrl);

        if (!searchResponse.ok) {
          throw new Error('SteamGridDB search failed');
        }

        const searchData = await searchResponse.json();

        if (searchData.success && searchData.data && searchData.data.length > 0) {
          // Get grid images for the first few results
          const results = [];
          const imageUrls = {};

          for (const game of searchData.data.slice(0, 9)) {
            try {
              // Fetch 600x900 grid images for this game
              const gridsUrl = `https://api.ascendara.app/api/proxy/steamgrid/grids/game/${game.id}?styles=alternate&dimensions=600x900`;
              const gridsResponse = await fetch(gridsUrl);

              if (gridsResponse.ok) {
                const gridsData = await gridsResponse.json();

                if (gridsData.success && gridsData.data && gridsData.data.length > 0) {
                  // Use the first grid image
                  const firstGrid = gridsData.data[0];
                  const gameId = game.id.toString();

                  results.push({
                    game: game.name,
                    title: game.name,
                    gameID: gameId,
                    imgID: gameId,
                    img: firstGrid.url,
                  });

                  imageUrls[gameId] = firstGrid.url;
                }
              }
            } catch (gridError) {
              console.warn(`Could not fetch grids for ${game.name}:`, gridError);
            }
          }

          setCoverSearch(prev => ({ ...prev, isLoading: false, results: results }));
          setCoverImageUrls(imageUrls);
        } else {
          setCoverSearch(prev => ({ ...prev, isLoading: false, results: [] }));
          setCoverImageUrls({});
        }
      } catch (err) {
        console.error("Error searching covers:", err);
        setCoverSearch(prev => ({ ...prev, isLoading: false, results: [] }));
        setCoverImageUrls({});
      }
    };

    return (
      <>
        {/* Edit Cover Dialog */}
        <AlertDialog open={showEditCoverDialog} onOpenChange={setShowEditCoverDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-2xl font-bold text-foreground">
                {t("library.changeCoverImage")}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-muted-foreground">
                {t("library.searchForCoverImage")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {/* Game Cover Search Section (copied and adapted from AddGameForm) */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="relative flex-grow">
                  <SearchIcon className="absolute left-2 top-1/2 h-4 w-4 -translate-y-5 transform text-muted-foreground" />
                  <Input
                    id="coverSearch"
                    value={coverSearch.query}
                    onChange={e => handleCoverSearch(e.target.value)}
                    className="border-input bg-background pl-8 text-foreground"
                    placeholder={t("library.searchGameCover")}
                    minLength={minSearchLength}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("library.searchGameCoverNotice")}
                  </p>
                </div>
              </div>
              {/* Cover Search Results */}
              {coverSearch.query.length < minSearchLength ? (
                <div className="py-2 text-center text-sm text-muted-foreground">
                  {t("library.enterMoreChars", { count: minSearchLength })}
                </div>
              ) : coverSearch.isLoading ? (
                <div className="flex justify-center py-4">
                  <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
                </div>
              ) : coverSearch.results.length > 0 ? (
                <div className="grid grid-cols-3 gap-4">
                  {coverSearch.results.map((cover, index) => (
                    <div
                      key={index}
                      onClick={() =>
                        setCoverSearch(prev => ({ ...prev, selectedCover: cover }))
                      }
                      className={cn(
                        "relative aspect-video cursor-pointer overflow-hidden rounded-lg border-2 transition-all",
                        coverSearch.selectedCover === cover
                          ? "border-primary shadow-lg"
                          : "border-transparent hover:border-primary/50"
                      )}
                    >
                      <img
                        src={cover.img}
                        alt={cover.title}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity hover:opacity-100">
                        <p className="px-2 text-center text-sm text-white">
                          {cover.title}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-2 text-center text-sm text-muted-foreground">
                  {t("library.noResultsFound")}
                </div>
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel
                className="text-primary"
                onClick={() => setShowEditCoverDialog(false)}
              >
                {t("common.cancel")}
              </AlertDialogCancel>
              <Button
                variant="primary"
                className="bg-primary text-secondary"
                disabled={!coverSearch.selectedCover}
                onClick={async () => {
                  if (!coverSearch.selectedCover) return;
                  // Fetch new image (no localStorage cache - persisted to disk
                  // by the main process via IPC)
                  try {
                    let dataUrl;
                    // For local index, load from local file system
                    if (settings.usingLocalIndex && coverSearch.selectedCover.gameID) {
                      if (coverImageUrls[coverSearch.selectedCover.gameID]) {
                        // Already loaded, convert blob URL to data URL for storage
                        const response = await fetch(
                          coverImageUrls[coverSearch.selectedCover.gameID]
                        );
                        const blob = await response.blob();
                        dataUrl = await new Promise(resolve => {
                          const reader = new FileReader();
                          reader.onloadend = () => resolve(reader.result);
                          reader.readAsDataURL(blob);
                        });
                      } else {
                        // Try to load from local file
                        const localImagePath = `${settings.localIndex}/imgs/${coverSearch.selectedCover.gameID}.jpg`;
                        const imageData = await window.electron.ipcRenderer.readFile(
                          localImagePath,
                          "base64"
                        );
                        dataUrl = `data:image/jpeg;base64,${imageData}`;
                      }
                    } else {
                      // Fetch from Steam CDN URL directly
                      const response = await fetch(coverSearch.selectedCover.img);
                      const blob = await response.blob();
                      dataUrl = await new Promise(resolve => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result);
                        reader.readAsDataURL(blob);
                      });
                    }
                    setImageData(dataUrl);
                    setShowEditCoverDialog(false);
                  } catch (e) {
                    console.error("Failed to update cover image", e);
                  }
                }}
              >
                {t("library.updateImage")}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete/Remove Game Confirmation Dialog */}
        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-2xl font-bold text-foreground">
                {t("library.confirmDelete")}
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-4 text-muted-foreground">
                {t("library.deleteConfirmMessage", { game: game.game || game.name })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex gap-2">
              <Button variant="outline" className="text-primary" onClick={() => setIsDeleteDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button className="text-secondary" onClick={confirmDeleteGame} disabled={isUninstalling}>
                {isUninstalling ? (
                  <>
                    <Loader className="mr-2 h-4 w-4 animate-spin" />
                    {t("library.deleting")}
                  </>
                ) : (
                  t("library.delete", { game: game.game || game.name })
                )}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Card
          className={cn(
            "group relative overflow-hidden rounded-xl border border-border bg-card shadow-md transition-all duration-200",
            "hover:-translate-y-1 hover:shadow-xl hover:border-primary/30",
            isSelected && "ring-2 ring-primary",
            selectionMode && game.isCustom && "selectable-card",
            "cursor-pointer"
          )}
          onClick={e => {
            if (selectionMode && game.isCustom) {
              e.stopPropagation();
              onSelectCheckbox();
            } else {
              onPlay();
            }
          }}
          onContextMenu={handleContextMenu}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {selectionMode && game.isCustom && (
            <div className="absolute left-2 top-2 z-20 flex items-center justify-center rounded bg-white/80 p-0.5 shadow backdrop-blur-sm">
              <input
                type="checkbox"
                checked={isSelected}
                tabIndex={-1}
                readOnly
                className="pointer-events-none h-5 w-5 rounded border-muted accent-primary focus:ring-primary"
              />
            </div>
          )}
          {/* Context Menu Portal */}
          {contextMenuOpen && createPortal(
            <div
              className="fixed inset-0 z-[9999] flex items-start justify-start"
              onClick={e => {
                e.preventDefault();
                e.stopPropagation();
                setContextMenuOpen(false);
              }}
              onContextMenu={e => e.preventDefault()}
            >
              {/* Backdrop with blur */}
              <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
              
              {/* Context Menu */}
              <div
                className="absolute animate-in fade-in zoom-in-95 duration-200 transition-all"
                style={{
                  top: contextMenuPosition.y,
                  left: contextMenuPosition.x,
                }}
                onClick={e => e.stopPropagation()}
              >
                <div className="min-w-[260px] max-h-[80vh] overflow-hidden rounded-xl border border-border/50 bg-popover/95 shadow-2xl backdrop-blur-xl">
                  {/* Header with game logo */}
                  <div className="flex items-center justify-center border-b border-border/50 bg-gradient-to-r from-primary/5 to-transparent px-3 py-3">
                    {logoData ? (
                      <img 
                        src={logoData} 
                        alt={game.game || game.name} 
                        className="h-8 max-w-[200px] object-contain"
                      />
                    ) : (
                      <span className="text-sm font-semibold text-foreground">
                        {game.game || game.name}
                      </span>
                    )}
                  </div>

                  {/* Menu Items */}
                  <div className="max-h-[calc(80vh-60px)] overflow-y-auto p-1.5">
                    {game.executable ? (
                      <button
                        onClick={handlePlayFromContext}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-all hover:bg-accent hover:translate-x-0.5"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/20 transition-all group-hover:bg-primary">
                          <Play className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-foreground">{t("common.contextMenu.playGame")}</div>
                          <div className="text-xs text-muted-foreground">
                            {t("common.contextMenu.playGameDescription")}
                          </div>
                        </div>
                      </button>
                    ) : null}
                    
                    <button
                      onClick={handleOpenDirectory}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-all hover:bg-accent hover:translate-x-0.5"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent/30">
                        <FolderOpen className="h-4 w-4 text-foreground" />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-foreground">{t("common.contextMenu.openDirectory")}</div>
                        <div className="text-xs text-muted-foreground">
                          {t("common.contextMenu.openDirectoryDescription")}
                        </div>
                      </div>
                    </button>
                    
                    {game.isCustom ? (
                      <button
                        onClick={handleRemoveGame}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-all hover:bg-destructive/10 hover:translate-x-0.5"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-red-500/20">
                          <Trash2 className="h-4 w-4 text-foreground" />
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-foreground">{t("common.contextMenu.removeGame")}</div>
                          <div className="text-xs text-muted-foreground">
                            {t("common.contextMenu.removeGameDescription")}
                          </div>
                        </div>
                      </button>
                    ) : (
                      <button
                        onClick={handleDeleteGame}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-all hover:bg-destructive/10 hover:translate-x-0.5"
                      >
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-red-500/20">
                          <Trash2 className="h-4 w-4 text-foreground" />
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-foreground">{t("common.contextMenu.deleteGame")}</div>
                          <div className="text-xs text-muted-foreground">
                            {t("common.contextMenu.deleteGameDescription")}
                          </div>
                        </div>
                      </button>
                    )}
                    
                    {/* Divider between game actions and default options */}
                    <div className="my-1.5 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
                    
                    {/* Report Issue */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsReportOpen(true);
                        setContextMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-all hover:bg-accent hover:translate-x-0.5"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent/30">
                        <TriangleAlert className="h-4 w-4 text-foreground" />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-foreground">{t("common.reportIssue")}</div>
                        <div className="text-xs text-muted-foreground">
                          {t("common.contextMenu.reportIssueDescription")}
                        </div>
                      </div>
                    </button>
                    
                    {/* Give Feedback */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        window.electron.openURL("https://ascendara.app/feedback");
                        setContextMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-all hover:bg-accent hover:translate-x-0.5"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-accent/30">
                        <MessageSquareText className="h-4 w-4 text-foreground" />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-foreground">{t("common.giveFeedback")}</div>
                        <div className="text-xs text-muted-foreground">
                          {t("common.contextMenu.shareFeedbackDescription")}
                        </div>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}

          <CardContent className="p-0">
            <div className="relative aspect-[2/3] overflow-hidden">
              {imageData ? (
                <img
                  src={imageData}
                  alt={game.game}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-muted">
                  <Gamepad2 className="h-12 w-12 text-muted-foreground/30" />
                </div>
              )}
              {/* Running indicator */}
              {isRunning && (
                <div className="absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-green-500 to-emerald-400" />
              )}
              {/* Badges row */}
              <div className="absolute left-2 top-2 z-20 flex flex-col gap-1">
                {typeof game.launchCount === "undefined" && !game.isCustom && (
                  <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-bold text-primary">
                    {t("library.newBadge")}
                  </span>
                )}
                {updateInfo?.updateAvailable && (
                  <span className="flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-xs font-bold text-secondary">
                    <Import className="h-3 w-3" />
                    {t("gameScreen.updateBadge")}
                  </span>
                )}
              </div>
              {/* Hover overlay with title + actions */}
              <div className={cn(
                "absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/80 via-black/20 to-transparent p-3 transition-opacity duration-200",
                isHovered ? "opacity-100" : "opacity-0"
              )}>
                <p className="mb-2 line-clamp-2 text-sm font-semibold leading-tight text-white">
                  {game.game}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    {game.online && <Gamepad2 className="h-3.5 w-3.5 text-white/70" />}
                    {game.dlc && <Gift className="h-3.5 w-3.5 text-white/70" />}
                    {isRunning && <span className="text-xs font-medium text-green-400">Playing</span>}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-white hover:bg-white/20 hover:text-primary"
                    onClick={e => { e.stopPropagation(); onToggleFavorite(game.game || game.name); }}
                  >
                    <Heart className={cn("h-4 w-4", isFavorite ? "fill-primary text-primary" : "fill-none text-white")} />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col items-start gap-1 px-3 py-2">
            <h3 className="w-full truncate text-sm font-semibold leading-tight text-foreground">
              {game.game}
            </h3>
            <p className="text-xs text-muted-foreground">
              {game.playTime !== undefined
                ? game.playTime < 60
                  ? t("library.lessThanMinute")
                  : game.playTime < 3600
                    ? `${Math.floor(game.playTime / 60)}m`
                    : `${Math.floor(game.playTime / 3600)}h`
                : t("library.neverPlayed")}
            </p>
          </CardFooter>
        </Card>
      </>
    );
  }
);

InstalledGameCard.displayName = "InstalledGameCard";

// Cloud-only game card with gray animation effect
const CloudOnlyGameCard = memo(({ game, imageData, onRestore, isRestoring }) => {
  const { t } = useLanguage();

  const formatPlaytime = seconds => {
    if (!seconds || seconds < 60) return t("library.neverPlayed");
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours === 0)
      return `${minutes} ${t("library.minutes")} ${t("library.ofPlaytime")}`;
    if (hours === 1) return `1 ${t("library.hour")} ${t("library.ofPlaytime")}`;
    return `${hours} ${t("library.hours")} ${t("library.ofPlaytime")}`;
  };

  const isCustomGame = game.isCustom;

  // Card-body click: this game isn't installed locally, so launching/inspecting
  // it isn't possible. Surface a clear warning telling the user to use the
  // Add & Restore button instead. The button's own onClick is stopped from
  // bubbling so it still works normally.
  const handleCardClick = () => {
    if (isRestoring) return;
    toast.warning(
      isCustomGame
        ? t("library.cloudOnly.noFilesFoundCustom") ||
            "No local files found for this custom game. Click \"Add & Restore\" to re-add it and recover your cloud playtime."
        : t("library.cloudOnly.noFilesFound") ||
            "No local files found for this game. Click \"Download & Restore\" to install it and recover your cloud playtime."
    );
  };

  return (
    <Card
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCardClick();
        }
      }}
      className={cn(
        "group relative cursor-pointer overflow-hidden rounded-xl border border-border bg-card shadow-lg transition-all duration-200",
        "hover:-translate-y-1 hover:shadow-xl",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      )}
    >
      <CardContent className="p-0">
        <div className="relative aspect-[2/3] overflow-hidden">
          {/* Gray overlay with shimmer animation */}
          <div
            className={cn(
              "absolute inset-0 z-10",
              isCustomGame
                ? "bg-gradient-to-br from-purple-400/60 via-purple-500/50 to-purple-600/60"
                : "bg-gradient-to-br from-gray-400/60 via-gray-500/50 to-gray-600/60"
            )}
          >
            {/* Animated shimmer effect */}
            <div
              className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite]"
              style={{
                background:
                  "linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)",
              }}
            />
          </div>
          {imageData ? (
            <img
              src={imageData}
              alt={game.name}
              className="h-full w-full border-b border-border object-cover grayscale"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted">
              <Gamepad2 className="h-12 w-12 text-muted-foreground/30" />
            </div>
          )}
          {/* Cloud badge - different color for custom games */}
          <span
            className={cn(
              "absolute left-2 top-2 z-20 flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium text-white",
              isCustomGame ? "bg-purple-500/90" : "bg-blue-500/90"
            )}
          >
            <Cloud className="h-3 w-3" />
            {isCustomGame
              ? t("library.cloudOnly.customBadge")
              : t("library.cloudOnly.badge")}
          </span>
        </div>
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-2 px-3 py-2">
        <div className="flex w-full items-center gap-1.5">
          <h3 className="flex-1 truncate text-sm font-semibold leading-tight text-foreground">
            {game.name}
          </h3>
          {game.online && <Gamepad2 className="h-3.5 w-3.5 text-muted-foreground" />}
          {game.dlc && <Gift className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
        <div className="flex w-full items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span>{formatPlaytime(game.playTime)}</span>
        </div>
        <Button
          onClick={e => {
            e.stopPropagation();
            onRestore?.();
          }}
          disabled={isRestoring}
          className={cn(
            "w-full gap-2 text-white",
            isCustomGame
              ? "bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600"
              : "bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600"
          )}
        >
          {isRestoring ? (
            <>
              <Loader className="h-4 w-4 animate-spin" />
              {t("library.cloudOnly.restoring")}
            </>
          ) : isCustomGame ? (
            <>
              <Plus className="h-4 w-4" />
              {t("library.cloudOnly.restoreCustom")}
            </>
          ) : (
            <>
              <CloudDownload className="h-4 w-4" />
              {t("library.cloudOnly.restore")}
            </>
          )}
        </Button>
      </CardFooter>
    </Card>
  );
});

CloudOnlyGameCard.displayName = "CloudOnlyGameCard";

// Play Later game card
const PlayLaterGameCard = memo(({ game, onDownload, onRemove }) => {
  const { t } = useLanguage();
  const [imageData, setImageData] = useState(null);

  // Load Play Later card image (no localStorage caching - quota issues with
  // base64 data URLs; SteamGridDB lookups are cached in-memory by the service)
  useEffect(() => {
    let isMounted = true;
    const loadImage = async () => {
      // 1. Load via imgID when available (games from Search/Download always have one)
      if (game.imgID) {
        try {
          const imageCacheService = await import("@/services/imageCacheService");
          const url = await imageCacheService.default.getImage(game.imgID, {
            priority: "normal",
            quality: "high",
          });
          if (url && isMounted) {
            setImageData(url);
            return;
          }
        } catch (error) {
          console.warn("imageCacheService failed for play later image:", error);
        }
      }

      // 2. Try SteamGridDB fallback when no imgID is available
      if (game.game && !game.imgID) {
        try {
          const steamGridImageService = await import("@/services/steamGridImageService");
          const assets = await steamGridImageService.default.getAssets(game.game);
          const imageUrl = steamGridImageService.default.pickUrl(assets, "card");
          if (imageUrl && isMounted) {
            setImageData(imageUrl);
            return;
          }
        } catch (error) {
          console.warn("SteamGridDB fallback failed for play later image:", error);
        }
      }
    };
    loadImage();
    return () => {
      isMounted = false;
    };
  }, [game.game, game.imgID]);

  const formatAddedDate = timestamp => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    return date.toLocaleDateString();
  };

  return (
    <Card
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border bg-card shadow-lg transition-all duration-200",
        "hover:-translate-y-1 hover:shadow-xl"
      )}
    >
      <CardContent className="p-0">
        <div className="relative aspect-[2/3] overflow-hidden">
          {/* Amber overlay with shimmer animation */}
          <div className="absolute inset-0 z-10 bg-gradient-to-br from-amber-400/40 via-orange-500/30 to-amber-600/40">
            <div
              className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite]"
              style={{
                background:
                  "linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)",
              }}
            />
          </div>
          {imageData ? (
            <img
              src={imageData}
              alt={game.game}
              className="h-full w-full border-b border-border object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted">
              <Gamepad2 className="h-12 w-12 text-muted-foreground/30" />
            </div>
          )}
          {/* Play Later badge */}
          <span className="absolute left-2 top-2 z-20 flex items-center gap-1 rounded bg-amber-500/90 px-2 py-0.5 text-xs font-medium text-white">
            <Clock className="h-3 w-3" />
            {t("library.playLater.badge")}
          </span>
          {/* Remove button */}
          <button
            onClick={e => {
              e.stopPropagation();
              onRemove();
            }}
            className="absolute right-2 top-2 z-20 rounded-full bg-black/50 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
            title={t("library.playLater.remove")}
          >
            <Plus className="h-3 w-3 rotate-45" />
          </button>
        </div>
      </CardContent>
      <CardFooter className="flex flex-col items-start gap-2 px-3 py-2">
        <div className="flex w-full items-center gap-1.5">
          <h3 className="flex-1 truncate text-sm font-semibold leading-tight text-foreground">
            {game.game}
          </h3>
          {game.online && <Gamepad2 className="h-3.5 w-3.5 text-muted-foreground" />}
          {game.dlc && <Gift className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
        <div className="flex w-full items-center justify-between text-xs text-muted-foreground">
          {game.size && <span>{game.size}</span>}
          {game.addedAt && (
            <span>
              {t("library.playLater.addedOn")} {formatAddedDate(game.addedAt)}
            </span>
          )}
        </div>
        <Button
          onClick={onDownload}
          className="w-full gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600"
        >
          <ArrowDown className="h-4 w-4" />
          {t("library.playLater.download")}
        </Button>
      </CardFooter>
    </Card>
  );
});

PlayLaterGameCard.displayName = "PlayLaterGameCard";

const AddGameForm = ({ onSuccess }) => {
  const { t } = useLanguage();
  const { settings } = useSettings();
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showImportingDialog, setShowImportingDialog] = useState(false);
  const [importSuccess, setImportSuccess] = useState(null);
  const [steamappsDirectory, setSteamappsDirectory] = useState("");
  const [isSteamappsDirectoryInvalid, setIsSteamappsDirectoryInvalid] = useState(false);

  // Handler for directory picking
  const handleChooseSteamappsDirectory = async () => {
    const dir = await window.electron.openDirectoryDialog();
    if (dir) setSteamappsDirectory(dir);
  };

  // Check if the steamappsDirectory contains 'common'
  useEffect(() => {
    if (steamappsDirectory && !steamappsDirectory.toLowerCase().includes("common")) {
      setIsSteamappsDirectoryInvalid(true);
    } else {
      setIsSteamappsDirectoryInvalid(false);
    }
  }, [steamappsDirectory]);

  const handleImportSteamGames = async () => {
    if (!steamappsDirectory) return;
    setIsSteamappsDirectoryInvalid(false);
    setShowImportDialog(false);
    setShowImportingDialog(true);
    setImportSuccess(null);
    try {
      await window.electron.importSteamGames(steamappsDirectory);
      setImportSuccess(true);
      await loadGames();
      setTimeout(() => {
        setShowImportingDialog(false);
        setImportSuccess(null);
      }, 1500);
    } catch (error) {
      setImportSuccess(false);
    }
  };

  // Close importing dialog
  const handleCloseImportingDialog = () => {
    setShowImportingDialog(false);
    setImportSuccess(null);
  };

  const [formData, setFormData] = useState({
    executable: "",
    name: "",
    hasVersion: false,
    version: "",
    isOnline: false,
    hasDLC: false,
  });
  const [coverSearch, setCoverSearch] = useState({
    query: "",
    isLoading: false,
    results: [],
    selectedCover: null,
  });
  const [coverImageUrls, setCoverImageUrls] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Add debounce timer ref
  const searchDebounceRef = useRef(null);
  const minSearchLength = 2;

  const handleCoverSearch = async query => {
    // Update query immediately for UI responsiveness
    setCoverSearch(prev => ({ ...prev, query }));

    // Clear previous timer
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    // Don't search if query is too short
    if (!query.trim() || query.length < minSearchLength) {
      setCoverSearch(prev => ({ ...prev, results: [], isLoading: false }));
      setCoverImageUrls({});
      return;
    }

    // Set up new debounce timer
    searchDebounceRef.current = setTimeout(async () => {
      setCoverSearch(prev => ({ ...prev, isLoading: true }));
      try {
        // Use SteamGridDB for proper grid covers (600x900 portrait)
        const searchUrl = `https://api.ascendara.app/api/proxy/steamgrid/search/autocomplete/${encodeURIComponent(query)}`;
        const searchResponse = await fetch(searchUrl);

        if (!searchResponse.ok) {
          throw new Error('SteamGridDB search failed');
        }

        const searchData = await searchResponse.json();

        if (searchData.success && searchData.data && searchData.data.length > 0) {
          // Get grid images for the first few results
          const results = [];
          const imageUrls = {};

          for (const game of searchData.data.slice(0, 9)) {
            try {
              // Fetch 600x900 grid images for this game
              const gridsUrl = `https://api.ascendara.app/api/proxy/steamgrid/grids/game/${game.id}?styles=alternate&dimensions=600x900`;
              const gridsResponse = await fetch(gridsUrl);

              if (gridsResponse.ok) {
                const gridsData = await gridsResponse.json();

                if (gridsData.success && gridsData.data && gridsData.data.length > 0) {
                  // Use the first grid image
                  const firstGrid = gridsData.data[0];
                  const gameId = game.id.toString();

                  results.push({
                    game: game.name,
                    title: game.name,
                    gameID: gameId,
                    imgID: gameId,
                    img: firstGrid.url,
                  });

                  imageUrls[gameId] = firstGrid.url;
                }
              }
            } catch (gridError) {
              console.warn(`Could not fetch grids for ${game.name}:`, gridError);
            }
          }

          if (results.length > 0) {
            const firstResult = results[0];
            setCoverSearch(prev => ({
              ...prev,
              results: results,
              selectedCover: firstResult,
              isLoading: false,
            }));
            setCoverImageUrls(imageUrls);
            return;
          }
        }

        // If no results found, show empty state
        setCoverSearch(prev => ({
          ...prev,
          results: [],
          selectedCover: null,
          isLoading: false,
        }));
        setCoverImageUrls({});
      } catch (error) {
        console.error("Error searching covers:", error);
        setCoverSearch(prev => ({
          ...prev,
          results: [],
          selectedCover: null,
          isLoading: false
        }));
        setCoverImageUrls({});
        toast.error(t("library.coverSearchError"));
      }
    }, 300); // 300ms debounce
  };

  const handleChooseExecutable = async () => {
    const file = await window.electron.openFileDialog();
    if (file) {
      const gameName = file.split("\\").pop().replace(".exe", "");
      setFormData(prev => ({
        ...prev,
        executable: file,
        name: gameName,
      }));

      // Automatically search for game cover using Steam API
      if (gameName) {
        handleCoverSearch(gameName);
      }
    }
  };

  const handleSubmit = async e => {
    if (e) e.preventDefault();

    console.log("[AddGameForm] handleSubmit called", { formData, isSubmitting });

    if (isSubmitting) {
      console.log("[AddGameForm] Already submitting, returning");
      return;
    }

    setIsSubmitting(true);

    try {
      console.log("[AddGameForm] Checking for duplicate games...");
      // Check if a game with this name already exists in the library
      const installedGames = await window.electron.getGames();
      const customGames = await window.electron.getCustomGames();

      console.log("[AddGameForm] Got games:", {
        installedCount: installedGames?.length,
        customCount: customGames?.length,
      });

      const allExistingGames = [...(installedGames || []), ...(customGames || [])];

      const gameExists = allExistingGames.some(
        game => (game.game || game.name)?.toLowerCase() === formData.name.toLowerCase()
      );

      console.log("[AddGameForm] Duplicate check result:", {
        gameExists,
        gameName: formData.name,
      });

      if (gameExists) {
        console.log("[AddGameForm] Duplicate found, showing error");
        setIsSubmitting(false);
        onSuccess(); // Close the add game dialog
        toast.error(t("library.addGame.duplicateError"));
        return;
      }

      console.log("[AddGameForm] Adding game to library...");
      // Pass the actual image URL from SteamGridDB (600x900 grid)
      const coverImageUrl = coverSearch.selectedCover?.img;
      const result = await window.electron.addGame(
        formData.name,
        formData.isOnline,
        formData.hasDLC,
        formData.version,
        formData.executable,
        coverImageUrl
      );

      console.log("[AddGameForm] Add game result:", result);

      if (result && !result.success) {
        console.error("[AddGameForm] Failed to add game:", result.error);
        setIsSubmitting(false);
        toast.error(result.error || "Failed to add game. Please try again.");
        return;
      }

      console.log("[AddGameForm] Game added successfully");

      // Download all game assets (grid, logo, hero) if a cover was selected
      if (coverSearch.selectedCover?.gameID) {
        console.log("[AddGameForm] Downloading game assets...");
        const assetTypes = [
          { type: "grids", key: "grid", filename: "grid.ascendara.jpg", params: "?styles=alternate&dimensions=600x900" },
          { type: "logos", key: "logo", filename: "logo.ascendara.png", params: "?styles=white&sort=score" },
          { type: "heroes", key: "hero", filename: "hero.ascendara.jpg", params: "?styles=alternate" },
        ];

        let downloadedCount = 0;
        for (const { type, filename, params } of assetTypes) {
          try {
            const url = `https://api.ascendara.app/api/proxy/steamgrid/${type}/game/${coverSearch.selectedCover.gameID}${params}`;
            const response = await fetch(url);

            if (response.ok) {
              const data = await response.json();
              if (data.success && data.data && data.data.length > 0) {
                const assetUrl = data.data[0].url;

                // Download the image
                const imageResponse = await fetch(assetUrl);
                const blob = await imageResponse.blob();

                // Convert to base64
                const reader = new FileReader();
                const base64Promise = new Promise(resolve => {
                  reader.onloadend = () => resolve(reader.result);
                  reader.readAsDataURL(blob);
                });

                const dataUrl = await base64Promise;

                // Save to game directory via IPC
                await window.electron.saveGameAsset(formData.name, filename, dataUrl);
                downloadedCount++;

                // If this is the grid image, notify library card via event
                if (type === "grids") {
                  window.dispatchEvent(
                    new CustomEvent("game-cover-updated", {
                      detail: { gameName: formData.name, dataUrl },
                    })
                  );
                }
              }
            }
          } catch (e) {
            console.warn(`[AddGameForm] Failed to download ${type}:`, e);
          }
        }
        console.log(`[AddGameForm] Downloaded ${downloadedCount} assets`);
      }

      toast.success(t("library.addGame.success"));
      setIsSubmitting(false);
      onSuccess();
    } catch (error) {
      console.error("[AddGameForm] Error in handleSubmit:", error);
      setIsSubmitting(false);
      toast.error("Failed to add game. Please try again.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <div className="space-y-2">
            <Button
              type="button"
              variant="outline"
              className="w-full justify-start truncate bg-background text-left font-normal text-primary hover:bg-accent"
              onClick={() => setShowImportDialog(true)}
            >
              <Import className="mr-2 h-4 w-4 flex-shrink-0" />
              <span>{t("library.importSteamGames")}</span>
            </Button>
          </div>

          <Separator className="my-2" />

          <Button
            type="button"
            variant="outline"
            className="w-full justify-start truncate bg-background text-left font-normal text-primary hover:bg-accent"
            onClick={handleChooseExecutable}
          >
            <FolderOpen className="mr-2 h-4 w-4 flex-shrink-0" />
            <span className="truncate">
              {formData.executable || t("library.chooseExecutableFile")}
            </span>
          </Button>

          {/* Import Steam Games Dialog */}
          <AlertDialog open={showImportDialog} onOpenChange={setShowImportDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-2xl font-bold text-foreground">
                  {t("library.importSteamGames")}
                </AlertDialogTitle>
                <AlertDialogDescription className="text-foreground">
                  <span>
                    {t("library.importSteamGamesDescription")}{" "}
                    <a
                      className="cursor-pointer text-primary hover:underline"
                      onClick={() =>
                        window.electron.openURL(
                          "https://ascendara.app/docs/features/overview#importing-from-steam"
                        )
                      }
                    >
                      {t("common.learnMore")}{" "}
                      <ExternalLink className="mb-1 inline-block h-3 w-3" />
                    </a>
                  </span>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2">
                <Label htmlFor="steamapps-directory" className="text-foreground">
                  {t("library.steamappsDirectory")}
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="steamapps-directory"
                    value={steamappsDirectory}
                    readOnly
                    className="flex-1 border-input bg-background text-foreground"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleChooseSteamappsDirectory}
                    className="bg-primary text-secondary"
                  >
                    {t("library.chooseDirectory")}
                  </Button>
                </div>
                {isSteamappsDirectoryInvalid && (
                  <div className="mt-1 text-sm font-semibold text-red-500">
                    {t("library.steamappsDirectoryMissingCommon")}
                  </div>
                )}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel
                  onClick={() => setSteamappsDirectory("")}
                  className="text-primary"
                >
                  {t("common.cancel")}
                </AlertDialogCancel>
                <Button
                  type="button"
                  onClick={handleImportSteamGames}
                  disabled={!steamappsDirectory}
                  className="bg-primary text-secondary"
                >
                  {t("library.import")}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Importing Dialog */}
        <AlertDialog open={showImportingDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="text-2xl font-bold text-foreground">
                {importSuccess === null && (
                  <>
                    <Loader className="text-foreground-muted mr-2 inline h-5 w-5 animate-spin" />
                    {t("library.importingGames")}
                  </>
                )}
                {importSuccess === true && t("library.importSuccessTitle")}
                {importSuccess === false && t("library.importFailedTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-foreground">
                {importSuccess === null && (
                  <div className="flex items-center gap-2">
                    {t("library.importingGamesDesc")}
                  </div>
                )}
                {importSuccess === true && (
                  <div className="text-foreground-muted">
                    {t("library.importSuccessDesc")}
                  </div>
                )}
                {importSuccess === false && (
                  <div className="text-foreground-muted">
                    {t("library.importFailedDesc")}
                  </div>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              {importSuccess !== null && (
                <Button
                  className="bg-primary text-secondary"
                  onClick={handleCloseImportingDialog}
                >
                  {t("common.ok")}
                </Button>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <div className="space-y-2">
          <Label htmlFor="name" className="text-foreground">
            {t("library.gameName")}
          </Label>
          <Input
            id="name"
            value={formData.name}
            onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
            className="border-input bg-background text-foreground"
          />
        </div>

        <Separator className="bg-border" />

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="hasVersion" className="flex-1 text-foreground">
              {t("library.version")}
            </Label>
            <Switch
              id="hasVersion"
              checked={formData.hasVersion}
              onCheckedChange={checked =>
                setFormData(prev => ({
                  ...prev,
                  hasVersion: checked,
                  version: !checked ? "" : prev.version,
                }))
              }
            />
          </div>

          {formData.hasVersion && (
            <Input
              id="version"
              value={formData.version}
              onChange={e => setFormData(prev => ({ ...prev, version: e.target.value }))}
              placeholder={t("library.versionPlaceholder")}
              className="border-input bg-background text-foreground"
            />
          )}
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="isOnline" className="flex-1 text-foreground">
            {t("library.hasOnlineFix")}
          </Label>
          <Switch
            id="isOnline"
            checked={formData.isOnline}
            onCheckedChange={checked =>
              setFormData(prev => ({ ...prev, isOnline: checked }))
            }
          />
        </div>

        <div className="flex items-center justify-between">
          <Label htmlFor="hasDLC" className="flex-1 text-foreground">
            {t("library.includesAllDLCs")}
          </Label>
          <Switch
            id="hasDLC"
            checked={formData.hasDLC}
            onCheckedChange={checked =>
              setFormData(prev => ({ ...prev, hasDLC: checked }))
            }
          />
        </div>

        {/* Game Cover Search Section */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-grow">
              <SearchIcon className="absolute left-2 top-1/2 h-4 w-4 -translate-y-2 transform text-muted-foreground" />
              <Input
                id="coverSearch"
                value={coverSearch.query}
                onChange={e => handleCoverSearch(e.target.value)}
                className="border-input bg-background pl-8 text-foreground"
                placeholder={t("library.searchGameCover")}
                minLength={minSearchLength}
              />
            </div>
          </div>

          {/* Cover Search Results */}
          {coverSearch.query.length < minSearchLength ? (
            <div className="py-2 text-center text-sm text-muted-foreground">
              {t("library.enterMoreChars", { count: minSearchLength })}
            </div>
          ) : coverSearch.isLoading ? (
            <div className="flex justify-center py-4">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary"></div>
            </div>
          ) : coverSearch.results.length > 0 ? (
            <div className="grid grid-cols-3 gap-4">
              {coverSearch.results.map((cover, index) => (
                <div
                  key={index}
                  onClick={() =>
                    setCoverSearch(prev => ({ ...prev, selectedCover: cover }))
                  }
                  className={cn(
                    "relative aspect-video cursor-pointer overflow-hidden rounded-lg border-2 transition-all",
                    coverSearch.selectedCover === cover
                      ? "border-primary shadow-lg"
                      : "border-transparent hover:border-primary/50"
                  )}
                >
                  <img
                    src={cover.img}
                    alt={cover.title}
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity hover:opacity-100">
                    <p className="px-2 text-center text-sm text-white">{cover.title}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-2 text-center text-sm text-muted-foreground">
              {t("library.noResultsFound")}
            </div>
          )}

          {/* Selected Cover Preview */}
          {coverSearch.selectedCover && (
            <div className="mt-4 flex justify-center">
              <div className="relative aspect-video w-64 overflow-hidden rounded-lg border-2 border-primary">
                <img
                  src={coverSearch.selectedCover.img}
                  alt={coverSearch.selectedCover.title}
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <AlertDialogFooter className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => onSuccess()} className="text-primary">
          {t("common.cancel")}
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!formData.executable || !formData.name || isSubmitting}
          className="bg-primary text-secondary"
        >
          {isSubmitting ? (
            <>
              <Loader className="mr-2 h-4 w-4 animate-spin" />
              {t("common.loading")}
            </>
          ) : (
            t("library.addGame.title")
          )}
        </Button>
      </AlertDialogFooter>
    </div>
  );
};

// Drag and Drop Components

// Draggable wrapper for game cards
const DraggableGameCard = ({ game, children }) => {
  const [{ isDragging }, drag] = useDrag(() => ({
    type: "GAME",
    item: { ...game },
    collect: monitor => ({
      isDragging: monitor.isDragging(),
    }),
  }));

  return (
    <div ref={drag} style={{ opacity: isDragging ? 0.5 : 1 }}>
      {children}
    </div>
  );
};

// Droppable wrapper for folder cards
const DroppableFolderCard = ({ folder, onDropGame, children }) => {
  const navigate = useNavigate();

  const [{ isOver, canDrop }, drop] = useDrop(() => ({
    accept: "GAME",
    drop: item => {
      if (onDropGame) onDropGame(item);
    },
    canDrop: item => {
      // Prevent dropping a game that's already in this folder
      return !folder.items?.some(g => (g.game || g.name) === (item.game || item.name));
    },
    collect: monitor => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }));

  return (
    <div
      ref={drop}
      style={{
        background: isOver && canDrop ? "#e0e7ff" : "transparent",
        borderRadius: "8px",
        transition: "background-color 0.2s",
      }}
      onClick={() => navigate(`/folderview/${encodeURIComponent(folder.game)}`)}
    >
      {children}
    </div>
  );
};

export default Library;

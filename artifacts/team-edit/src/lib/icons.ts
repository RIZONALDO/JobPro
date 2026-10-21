/**
 * Ícones do app: todos vêm do Phosphor Icons (MIT, https://phosphoricons.com), espessura "light".
 * A espessura e o tamanho padrão ficam no IconContext em App.tsx; para trocar o visual do app inteiro, é lá.
 *
 * Os nomes exportados são os mesmos que o código já usava, para as telas não precisarem mudar.
 * A escolha de cada desenho fica aqui. Não desenhamos SVG próprio: só ícones da biblioteca.
 */
export type { Icon, IconProps, IconWeight } from "@phosphor-icons/react";
export { IconContext } from "@phosphor-icons/react";

export {
  /* navegação e estrutura */
  SquaresFour as LayoutDashboard,
  Queue as ListOrdered,                 // Fila
  FilmSlate as ClipboardList,           // Jobs (claquete: é produtora de vídeo)
  Gauge,                                // Supervisão
  ChartBar as BarChart3,                // Relatórios
  UsersThree as Users,                  // Membros
  UsersThree as Users2,
  ShieldCheck as Shield,                // Plantões
  GearSix as Settings,
  SlidersHorizontal as Settings2,
  List as Menu,
  ListBullets as List,
  ListChecks as ListTodo,
  Rows as LayoutList,
  GridFour as LayoutGrid,
  SignOut as LogOut,
  MagnifyingGlass as Search,

  /* setas e cursores */
  ArrowDown, ArrowUp, ArrowLeft, ArrowRight,
  ArrowDownRight, ArrowUpRight,
  ArrowSquareOut as ExternalLink,
  ArrowsClockwise as RefreshCw,
  ArrowCounterClockwise as RotateCcw,
  ArrowUUpLeft as Undo2,
  ArrowBendUpLeft as Reply,
  CaretDown as ChevronDown,
  CaretUp as ChevronUp,
  CaretLeft as ChevronLeft,
  CaretRight as ChevronRight,
  CaretUpDown as ChevronsUpDown,
  Shuffle,
  BookmarkSimple as Bookmark,           // visões salvas (Relatórios)
  Funnel,
  StackSimple as Group,

  /* ações */
  Plus, Minus, X, Check,
  Checks as CheckCheck,
  PencilSimple as Pencil,
  PencilSimpleLine as Edit3,
  Trash as Trash2,
  Copy,
  FloppyDisk as Save,
  DownloadSimple as Download,
  PaperPlaneRight as Send,
  LinkSimple as Link2,
  DotsThree as MoreHorizontal,
  Play, Pause,
  PlayCircle, PauseCircle,
  CircleNotch as Loader2,               // girando = carregando

  /* estado e avisos */
  CheckCircle as CheckCircle2,
  XCircle,
  Warning as AlertTriangle,
  Warning as TriangleAlert,
  WarningCircle as AlertCircle,
  WarningOctagon as AlertOctagon,
  Newspaper,                            // Feed (mural da equipe)
  PushPin, PushPinSlash,                // recado fixado
  HandsClapping,                        // reconhecimento
  MegaphoneSimple as Megaphone,         // recado
  SealCheck,                            // entrega
  Heart,                                // curtir
  Export as Share,                      // compartilhar
  HandWaving,                           // cutucar
  Bell,
  BellRinging as BellRing,
  Eye,
  EyeSlash as EyeOff,
  LockSimple as Lock,
  Key as KeyRound,
  Circle,
  Confetti,
  Info,
  Question,
  Scales,                               // estimativa contestada
  HandPalm,                             // travado
  ArrowsDownUp,                         // pedido de troca na fila
  Timer,                                // atraso
  ClockUser,                            // pessoa e relógio

  /* tempo */
  Clock,
  Calendar,
  CalendarDots as CalendarDays,
  CalendarDots as CalendarClock,
  CalendarBlank as CalendarRange,
  CalendarPlus,
  Hourglass,

  /* pessoas e conversa */
  User, UserCheck, UserCircle, UserPlus,
  UserMinus as UserX,
  At as AtSign,
  EnvelopeSimple as Mail,
  Phone,
  ChatCircle as MessageCircle,
  Smiley as SmilePlus,
  Island as Palmtree,                   // ausência / férias

  /* arquivos e mídia */
  Folder, FolderOpen,
  FolderStar as FolderCheck,
  FileText,
  Camera,
  ImageSquare as ImagePlus,
  SpeakerHigh as Volume2,
  SpeakerSlash as VolumeX,
  Briefcase,

  /* aparência */
  Sun, Moon, Palette,
  TextAa as ALargeSmall,
  Flask as FlaskConical,
} from "@phosphor-icons/react";

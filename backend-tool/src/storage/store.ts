import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Almacén de proyectos y permisos.
 *
 * `ProjectStore` es una interfaz porque la implementación real será PostgreSQL
 * (stack §3.3) y la de aquí es de fichero: sirve para desarrollar y probar sin
 * levantar una base de datos, y hace explícito qué operaciones necesita
 * realmente el servicio. El contenido del diagrama *no* vive aquí —vive en el
 * documento CRDT, que persiste aparte— porque son dos ciclos de vida distintos:
 * los metadatos cambian rara vez y el documento, en cada pulsación.
 */

export type Role = 'owner' | 'editor' | 'viewer';

export interface Project {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Membership {
  projectId: string;
  userId: string;
  role: Role;
}

export interface ProjectStore {
  createProject(input: { name: string; description: string; ownerId: string }): Promise<Project>;
  getProject(id: string): Promise<Project | null>;
  listProjectsForUser(userId: string): Promise<(Project & { role: Role })[]>;
  renameProject(id: string, name: string, description: string): Promise<Project | null>;
  deleteProject(id: string): Promise<boolean>;
  addMember(projectId: string, userId: string, role: Role): Promise<Membership>;
  removeMember(projectId: string, userId: string): Promise<boolean>;
  listMembers(projectId: string): Promise<Membership[]>;
  roleOf(projectId: string, userId: string): Promise<Role | null>;
}

interface Snapshot {
  projects: Project[];
  memberships: Membership[];
}

/**
 * Implementación en memoria con volcado a un único fichero JSON.
 *
 * El volcado es «best effort» y se serializa en una promesa encadenada para que
 * dos escrituras concurrentes no se pisen. No es una base de datos y no
 * pretende serlo: sin transacciones, un fallo a mitad de escritura pierde el
 * último cambio de metadatos. Aceptable para desarrollo, no para producción.
 */
export class FileProjectStore implements ProjectStore {
  private projects = new Map<string, Project>();
  private memberships: Membership[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(private readonly filePath: string) {}

  static async open(dataDir: string): Promise<FileProjectStore> {
    const filePath = join(resolve(dataDir), 'proyectos.json');
    const store = new FileProjectStore(filePath);
    await store.load();
    return store;
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const snapshot = JSON.parse(raw) as Snapshot;
      this.projects = new Map(snapshot.projects.map((p) => [p.id, p]));
      this.memberships = snapshot.memberships;
    } catch (error) {
      // Primer arranque: no hay fichero todavía. Cualquier otro error sí es real.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private persist(): void {
    const snapshot: Snapshot = {
      projects: [...this.projects.values()],
      memberships: this.memberships,
    };
    this.writeQueue = this.writeQueue
      .then(async () => {
        await mkdir(dirname(this.filePath), { recursive: true });
        await writeFile(this.filePath, JSON.stringify(snapshot, null, 2), 'utf8');
      })
      .catch((error: unknown) => {
        console.error('No se pudo persistir el almacén de proyectos:', error);
      });
  }

  /** Espera a que termine el volcado pendiente. Solo lo usan las pruebas y el apagado. */
  async flush(): Promise<void> {
    await this.writeQueue;
  }

  async createProject(input: {
    name: string;
    description: string;
    ownerId: string;
  }): Promise<Project> {
    const now = new Date().toISOString();
    const project: Project = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      ownerId: input.ownerId,
      createdAt: now,
      updatedAt: now,
    };
    this.projects.set(project.id, project);
    this.memberships.push({ projectId: project.id, userId: input.ownerId, role: 'owner' });
    this.persist();
    return project;
  }

  async getProject(id: string): Promise<Project | null> {
    return this.projects.get(id) ?? null;
  }

  async listProjectsForUser(userId: string): Promise<(Project & { role: Role })[]> {
    return this.memberships
      .filter((m) => m.userId === userId)
      .flatMap((m) => {
        const project = this.projects.get(m.projectId);
        return project ? [{ ...project, role: m.role }] : [];
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async renameProject(id: string, name: string, description: string): Promise<Project | null> {
    const project = this.projects.get(id);
    if (!project) return null;

    const updated: Project = {
      ...project,
      name,
      description,
      updatedAt: new Date().toISOString(),
    };
    this.projects.set(id, updated);
    this.persist();
    return updated;
  }

  async deleteProject(id: string): Promise<boolean> {
    const existed = this.projects.delete(id);
    if (!existed) return false;
    this.memberships = this.memberships.filter((m) => m.projectId !== id);
    this.persist();
    return true;
  }

  async addMember(projectId: string, userId: string, role: Role): Promise<Membership> {
    const existing = this.memberships.find(
      (m) => m.projectId === projectId && m.userId === userId,
    );
    if (existing) {
      existing.role = role;
      this.persist();
      return existing;
    }

    const membership: Membership = { projectId, userId, role };
    this.memberships.push(membership);
    this.persist();
    return membership;
  }

  async removeMember(projectId: string, userId: string): Promise<boolean> {
    const before = this.memberships.length;
    this.memberships = this.memberships.filter(
      (m) => !(m.projectId === projectId && m.userId === userId),
    );
    const removed = this.memberships.length < before;
    if (removed) this.persist();
    return removed;
  }

  async listMembers(projectId: string): Promise<Membership[]> {
    return this.memberships.filter((m) => m.projectId === projectId);
  }

  async roleOf(projectId: string, userId: string): Promise<Role | null> {
    return (
      this.memberships.find((m) => m.projectId === projectId && m.userId === userId)?.role ??
      null
    );
  }
}

/** Jerarquía de permisos: quien puede editar, puede leer. */
export function roleAllows(role: Role | null, required: Role): boolean {
  if (!role) return false;
  const rank: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };
  return rank[role] >= rank[required];
}

import type { TelegramEntityInput } from "./entity-resolver.js";
import { EntityResolver } from "./entity-resolver.js";
import { MtprotoClientContext } from "./client-context.js";

function formatUser(user: any) {
  return {
    id: user?.id ?? null,
    username: user?.username ?? null,
    firstName: user?.firstName ?? user?.first_name ?? null,
    lastName: user?.lastName ?? user?.last_name ?? null,
    phone: user?.phone ?? null,
    bot: Boolean(user?.bot),
    verified: Boolean(user?.verified),
    premium: Boolean(user?.premium),
  };
}

export class ProfileService {
  constructor(
    private readonly context: MtprotoClientContext,
    private readonly resolver: EntityResolver,
  ) {}

  async getMe(input: { accountRef: string }) {
    return this.context.withClient(input.accountRef, "profile", "get_me", async ({ client }) => {
      const me = await client.getMe();
      return {
        ok: true,
        me: formatUser(me),
      };
    });
  }

  async updateProfile(input: {
    accountRef: string;
    firstName?: string;
    lastName?: string;
    about?: string;
  }) {
    return this.context.withClient(input.accountRef, "profile", "update_profile", async ({ client, gram }) => {
      const Api = gram.Api as any;
      const result = await client.invoke(
        new Api.account.UpdateProfile({
          firstName: input.firstName,
          lastName: input.lastName,
          about: input.about,
        }),
      );
      return {
        ok: true,
        result,
      };
    });
  }

  async deleteProfilePhoto(input: { accountRef: string }) {
    return this.context.withClient(
      input.accountRef,
      "profile",
      "delete_profile_photo",
      async ({ client, gram }) => {
        const Api = gram.Api as any;
        const result = await client.invoke(
          new Api.photos.UpdateProfilePhoto({
            id: new Api.InputPhotoEmpty(),
          }),
        );
        return {
          ok: true,
          result,
        };
      },
    );
  }

  async getUserPhotos(input: {
    accountRef: string;
    userId: TelegramEntityInput;
    limit?: number;
  }) {
    return this.context.withClient(input.accountRef, "profile", "get_user_photos", async ({ client }) => {
      const user = await this.resolver.resolveEntity(client, input.userId);
      const photos = await (client as any).getProfilePhotos(user, {
        limit: input.limit ?? 20,
      });
      const items = Array.isArray(photos) ? photos : [];
      return {
        ok: true,
        count: items.length,
        photos: items.map((photo: any) => ({
          id: photo?.id ?? null,
          date: photo?.date ?? null,
          sizes: photo?.sizes ?? [],
          hasVideo: Boolean(photo?.videoSizes),
        })),
      };
    });
  }

  async getUserStatus(input: { accountRef: string; userId: TelegramEntityInput }) {
    return this.context.withClient(input.accountRef, "profile", "get_user_status", async ({ client }) => {
      const user = (await this.resolver.resolveEntity(client, input.userId)) as any;
      return {
        ok: true,
        user: formatUser(user),
        status: user?.status ?? null,
      };
    });
  }
}

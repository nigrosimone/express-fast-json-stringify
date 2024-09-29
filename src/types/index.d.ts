declare global {
  namespace Express {
    interface Response {
      /**
       * Send JSON response.
       *
       * Examples:
       * ```ts
       * res.fastJson({ user: 'tj' });
       * res.status(200).fastJson({ user: 'tj' });
       * ```
       */
      fastJson: (data: any) => Response;
    }
  }
}

export {};
